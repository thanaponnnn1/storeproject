// ทดสอบเกณฑ์ ✔ ของเฟส 6 (Hardening: audit, รายงาน, สิทธิ์, load, cron, Cloudinary)
const BASE = 'http://localhost:3009';
const results = [];

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}
const check = (name, cond, detail = '') =>
  results.push({ name, pass: !!cond, detail });

const login = async (email) =>
  (await req('POST', '/api/auth/login', { email, password: 'Admin@1234' })).data
    .accessToken;

const admin = await login('admin@store.local');
const manager = await login('manager@store.local');
const sales = await login('sales@store.local');
const wh = await login('warehouse@store.local');

const stamp = Date.now();
const W = (await req('GET', '/api/warehouses', null, admin)).data.find(
  (w) => w.code === 'WH-MAIN',
).id;
const uomBag = (await req('GET', '/api/uoms', null, admin)).data.find(
  (u) => u.code === 'BAG',
).id;

// ============ 6.1 Audit log ============
const prod = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `P6-${stamp}`,
      name: 'สินค้าทดสอบเฟส 6',
      baseUomId: uomBag,
      priceRetail: 100,
      minStock: 20,
    },
    admin,
  )
).data;

const auditAfterCreate = (
  await req('GET', '/api/audit-logs?action=products&limit=5', null, admin)
).data;
const createEntry = auditAfterCreate.data.find(
  (a) => a.action === 'products.create' && a.statusCode === 201,
);
check(
  '6.1 สร้างสินค้าแล้วมี audit log บันทึกอัตโนมัติ',
  Boolean(createEntry),
  createEntry?.action,
);
check(
  '6.1 audit log บันทึกว่าใครทำ (email + role) และจาก IP ไหน',
  createEntry?.userEmail === 'admin@store.local' &&
    createEntry?.userRole === 'ADMIN' &&
    Boolean(createEntry?.ip),
  `${createEntry?.userEmail} / ${createEntry?.userRole} / ${createEntry?.ip}`,
);
check(
  '6.1 audit log เก็บ payload ที่ส่งมาด้วย',
  createEntry?.payload?.sku === prod.sku,
);

// login ต้องไม่เก็บรหัสผ่านลง audit
await req('POST', '/api/auth/login', {
  email: 'admin@store.local',
  password: 'Admin@1234',
});
const authLogs = (
  await req('GET', '/api/audit-logs?entityType=auth&limit=5', null, admin)
).data;
check(
  '6.1 audit log ปิดบังรหัสผ่าน (ไม่เก็บ plaintext)',
  authLogs.data.length > 0 &&
    authLogs.data.every((a) => a.payload?.password === '[REDACTED]'),
  JSON.stringify(authLogs.data[0]?.payload),
);

// GET ไม่ถูกบันทึก (ไม่งั้น log ท่วม)
const beforeGets = (await req('GET', '/api/audit-logs?limit=1', null, admin))
  .data.meta.total;
await req('GET', '/api/products?limit=1', null, admin);
await req('GET', '/api/partners?limit=1', null, admin);
const afterGets = (await req('GET', '/api/audit-logs?limit=1', null, admin)).data
  .meta.total;
check(
  '6.1 การอ่านข้อมูล (GET) ไม่ถูกบันทึก — เก็บเฉพาะการเปลี่ยนแปลง',
  afterGets === beforeGets,
  `${beforeGets} → ${afterGets}`,
);

// ประวัติของเอกสารชิ้นเดียว
await req('PATCH', `/api/products/${prod.id}`, { name: 'แก้ชื่อรอบ 1' }, admin);
await req('PATCH', `/api/products/${prod.id}`, { name: 'แก้ชื่อรอบ 2' }, admin);
const entityHistory = (
  await req('GET', `/api/audit-logs/entity/products/${prod.id}`, null, admin)
).data;
check(
  '6.1 ดูประวัติของสินค้าชิ้นเดียวได้ครบทุกครั้งที่แก้',
  entityHistory.length >= 2,
  `${entityHistory.length} รายการ`,
);
const auditBySales = await req('GET', '/api/audit-logs', null, sales);
check('6.1 พนักงานขายดู audit log → 403', auditBySales.status === 403);

// ============ 6.2 รายงาน ============
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: prod.id, warehouseId: W, qty: 10, unitCost: 60, refDocId: `P6R-${stamp}` },
  wh,
);

const stockValue = (
  await req('GET', '/api/reports/stock-value', null, manager)
).data;
const row = stockValue.items.find((i) => i.sku === prod.sku);
check(
  '6.2 มูลค่าสต๊อก: 10 ถุง × ทุน 60 = 600',
  Number(row.qtyOnHand) === 10 && Number(row.value) === 600,
  `qty=${row?.qtyOnHand} value=${row?.value}`,
);

const valueYesterday = (
  await req(
    'GET',
    `/api/reports/stock-value?asOf=${new Date(Date.now() - 86400000).toISOString()}`,
    null,
    manager,
  )
).data;
check(
  '6.2 ย้อนดูมูลค่าสต๊อกเมื่อวานได้ (สินค้านี้ยังไม่มี = ไม่อยู่ในรายงาน)',
  !valueYesterday.items.some((i) => i.sku === prod.sku),
);

const lowStock = (await req('GET', '/api/reports/low-stock', null, wh)).data;
check(
  '6.2 สินค้าต่ำกว่าจุดสั่งซื้อ: มี 10 ต่ำกว่า min 20 → ขาดอีก 10',
  lowStock.some((i) => i.sku === prod.sku && Number(i.shortBy) === 10),
  lowStock.find((i) => i.sku === prod.sku)?.shortBy,
);

const monthly = (await req('GET', '/api/reports/monthly-sales', null, manager))
  .data;
check(
  '6.2 ยอดขายรายเดือนมีข้อมูลและรวมยอดทั้งปีได้',
  monthly.months.length > 0 && Number(monthly.yearTotal) > 0,
  `${monthly.months.length} เดือน รวม ${monthly.yearTotal}`,
);

const aging = (await req('GET', '/api/reports/ar-aging', null, manager)).data;
check(
  '6.2 ลูกหนี้ค้างชำระแยกช่วงอายุหนี้ครบ 5 ช่วง',
  ['notDue', 'd1to30', 'd31to60', 'd61to90', 'over90'].every(
    (k) => k in aging.buckets,
  ),
);

// ============ 6.3 ตรวจสิทธิ์ทุก endpoint ตามตาราง ============
const matrix = [
  // [ชื่อ, method, path, body, { admin, manager, sales, warehouse }]
  ['ดูสินค้า', 'GET', '/api/products?limit=1', null, { admin: 200, manager: 200, sales: 200, wh: 200 }],
  ['สร้างสินค้า', 'POST', '/api/products', { sku: `MX-${stamp}-x`, name: 'x', baseUomId: uomBag }, { sales: 403, wh: 403 }],
  ['ปรับยอดสต๊อก', 'POST', '/api/inventory/adjustments', { productId: prod.id, warehouseId: W, actualQty: 10, reason: 'MX' }, { sales: 403, wh: 403 }],
  ['อนุมัติใบสั่งซื้อ', 'PATCH', '/api/purchase-orders/00000000-0000-4000-8000-000000000000/approve', null, { sales: 403, wh: 403 }],
  ['ดูรายงานกำไร', 'GET', '/api/reports/gross-profit', null, { manager: 200, sales: 403, wh: 403 }],
  ['ดูมูลค่าสต๊อก', 'GET', '/api/reports/stock-value', null, { manager: 200, sales: 403, wh: 403 }],
  ['ดู audit log', 'GET', '/api/audit-logs?limit=1', null, { manager: 200, sales: 403, wh: 403 }],
  ['ดูรายชื่อผู้ใช้', 'GET', '/api/users', null, { admin: 200, manager: 403, sales: 403, wh: 403 }],
  ['ตรวจกระทบยอด', 'GET', '/api/inventory/reconcile', null, { manager: 200, sales: 403, wh: 403 }],
];
const tokens = { admin, manager, sales, wh };
let matrixFails = [];
for (const [label, method, path, body, expectations] of matrix) {
  for (const [role, expected] of Object.entries(expectations)) {
    const res = await req(method, path, body, tokens[role]);
    if (res.status !== expected) {
      matrixFails.push(`${label}/${role}: ได้ ${res.status} ควรเป็น ${expected}`);
    }
  }
}
check(
  '6.3 สิทธิ์ทุก endpoint ตรงตามตารางที่ออกแบบไว้',
  matrixFails.length === 0,
  matrixFails.join(' | '),
);

// ============ 6.4 Load test: 50 concurrent ============
const loadProd = (
  await req(
    'POST',
    '/api/products',
    { sku: `P6-LOAD-${stamp}`, name: 'สินค้าทดสอบโหลด', baseUomId: uomBag },
    admin,
  )
).data;
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: loadProd.id, warehouseId: W, qty: 100, unitCost: 10, refDocId: `LOAD-${stamp}` },
  wh,
);

const t0 = Date.now();
const loadResults = await Promise.all(
  Array.from({ length: 50 }, (_, i) =>
    req(
      'POST',
      '/api/inventory/issues',
      { productId: loadProd.id, warehouseId: W, qty: 3, refDocId: `LOAD-I-${stamp}-${i}` },
      wh,
    ),
  ),
);
const elapsed = Date.now() - t0;
const ok = loadResults.filter((r) => r.status === 201).length;
const outOfStock = loadResults.filter((r) => r.status === 422).length;
const throttled = loadResults.filter((r) => r.status === 429).length;
const errors = loadResults.filter((r) => r.status >= 500).length;
const loadBal = Number(
  (await req('GET', `/api/inventory/balances?productId=${loadProd.id}`, null, wh))
    .data[0].qtyOnHand,
);
// สิ่งที่ต้องจริงเสมอ: ยอดคงเหลือ = 100 − (จำนวนที่สำเร็จ × 3) และห้ามติดลบ
check(
  '6.4 ยิงจ่ายพร้อมกัน 50 request: ยอดคงเหลือตรงกับจำนวนที่สำเร็จเป๊ะ ไม่ขายเกิน ไม่มี error 5xx',
  loadBal === 100 - ok * 3 && loadBal >= 0 && errors === 0 && ok > 0,
  `สำเร็จ ${ok} (${ok * 3} ชิ้น) ของหมด ${outOfStock} ติด rate limit ${throttled} error ${errors} เหลือ ${loadBal} ใช้เวลา ${elapsed}ms`,
);
check(
  '6.4 จ่ายได้ไม่เกินของที่มี (100 ชิ้น)',
  ok * 3 <= 100,
  `จ่ายไป ${ok * 3} จาก 100`,
);
check(
  '6.4 ไม่มี deadlock — ทุก request ได้คำตอบภายใน 30 วินาที',
  elapsed < 30000,
  `${elapsed}ms (เฉลี่ย ${Math.round(elapsed / 50)}ms/req)`,
);

const recAfterLoad = (await req('GET', '/api/inventory/reconcile', null, admin))
  .data;
check(
  '6.4 reconcile สะอาดหลังยิงโหลดหนัก',
  recAfterLoad.clean === true,
  JSON.stringify(recAfterLoad.mismatches),
);

// ============ 6.5 Cron ============
const runReconcile = await req('POST', '/api/scheduler/run/reconcile', null, admin);
check('6.5 สั่งรัน reconcile เองได้', runReconcile.status === 201 && runReconcile.data.clean === true);

const runExpire = await req(
  'POST',
  '/api/scheduler/run/expire-quotations',
  null,
  admin,
);
check(
  '6.5 สั่งทำใบเสนอราคาหมดอายุเองได้',
  runExpire.status === 201 && typeof runExpire.data.expired === 'number',
);

const alerts = await req('POST', '/api/scheduler/run/daily-alerts', null, admin);
check(
  '6.5 สรุปแจ้งเตือนประจำวันครบ 3 หัวข้อ (ของใกล้หมด/ล็อตใกล้หมดอายุ/หนี้เกินกำหนด)',
  alerts.status === 201 &&
    typeof alerts.data.lowStockCount === 'number' &&
    typeof alerts.data.expiringLotCount === 'number' &&
    typeof alerts.data.overdueInvoiceCount === 'number',
  JSON.stringify(alerts.data),
);
const alertsBySales = await req(
  'POST',
  '/api/scheduler/run/daily-alerts',
  null,
  sales,
);
check('6.5 พนักงานขายสั่งรันงานประจำ → 403', alertsBySales.status === 403);

// ============ 6.6 Cloudinary ============
const sig = await req('POST', '/api/uploads/signature', { folder: 'products' }, wh);
if (sig.status === 201) {
  check(
    '6.6 ขอลายเซ็นอัปโหลดได้ครบ (signature + timestamp + apiKey + uploadUrl)',
    Boolean(sig.data.signature) &&
      Boolean(sig.data.timestamp) &&
      Boolean(sig.data.apiKey) &&
      sig.data.uploadUrl?.includes('api.cloudinary.com'),
    `cloud=${sig.data.cloudName}`,
  );
  check(
    '6.6 ลายเซ็นเป็น sha1 40 ตัวอักษร',
    /^[a-f0-9]{40}$/.test(sig.data.signature ?? ''),
  );
} else {
  check(
    '6.6 ยังไม่ได้ใส่ CLOUDINARY_API_KEY/SECRET → endpoint ตอบ 503 พร้อมบอกวิธีแก้',
    sig.status === 503 && /CLOUDINARY/.test(sig.data?.message ?? ''),
    sig.data?.message,
  );
}

const withImage = await req(
  'PATCH',
  `/api/products/${prod.id}`,
  { imagePublicId: 'products/test-image' },
  admin,
);
const prodFull = (await req('GET', `/api/products/${prod.id}`, null, wh)).data;
check(
  '6.6 ผูก public_id กับสินค้าแล้วระบบสร้าง URL รูปแบบ thumbnail ให้',
  withImage.status === 200 &&
    prodFull.imageUrl?.includes('res.cloudinary.com') &&
    prodFull.imageUrl?.includes('f_auto,q_auto,w_400') &&
    prodFull.imageUrl?.endsWith('products/test-image'),
  prodFull.imageUrl,
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
