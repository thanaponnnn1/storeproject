// ทดสอบเกณฑ์ ✔ ของเฟส 2 (Inventory Ledger + Average) ตาม STEPS.md
// ใช้สินค้า DRL-MK-13 (สว่าน, NONE/AVG) เพื่อไม่ปนกับข้อมูลอื่น
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

const admin = (
  await req('POST', '/api/auth/login', {
    email: 'admin@store.local',
    password: 'Admin@1234',
  })
).data.accessToken;
const wh = (
  await req('POST', '/api/auth/login', {
    email: 'warehouse@store.local',
    password: 'Admin@1234',
  })
).data.accessToken;

const uomsAll = (await req('GET', '/api/uoms', null, admin)).data;
const drill = (
  await req('POST', '/api/products', {
    sku: `P2-AVG-${Date.now()}`,
    name: 'ทดสอบเฟส 2 (AVG)',
    baseUomId: uomsAll.find((u) => u.code === 'PCS').id,
  }, admin)
).data;
const whMain = (await req('GET', '/api/warehouses', null, admin)).data.find(
  (w) => w.code === 'WH-MAIN',
);
const P = drill.id;
const W = whMain.id;

// --- 2.3 รับเข้า + average: 10@100 แล้ว 10@200 → avg 150 ---
const r1 = await req(
  'POST',
  '/api/inventory/receipts',
  { productId: P, warehouseId: W, qty: 10, unitCost: 100, refDocId: 'TST-R1' },
  wh,
);
check('2.3 รับ 10@100 สำเร็จ (role WAREHOUSE)', r1.status === 201);
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: P, warehouseId: W, qty: 10, unitCost: 200, refDocId: 'TST-R2' },
  wh,
);
let bal = (
  await req('GET', `/api/inventory/balances?productId=${P}`, null, wh)
).data[0];
check(
  '2.3 avg = 150 หลังรับ 10@100 + 10@200',
  Number(bal?.avgCost) === 150 && Number(bal?.qtyOnHand) === 20,
  `qty=${bal?.qtyOnHand} avg=${bal?.avgCost}`,
);

// --- 2.4 จ่ายเกินยอด → 422 ---
const over = await req(
  'POST',
  '/api/inventory/issues',
  { productId: P, warehouseId: W, qty: 21, refDocId: 'TST-OVER' },
  wh,
);
check(
  '2.4 จ่าย 21 จาก 20 → 422 พร้อมข้อความยอดไม่พอ',
  over.status === 422 && /สต๊อกไม่พอ/.test(over.data?.message ?? ''),
  over.data?.message,
);

// --- 2.5 ยิงจ่ายพร้อมกัน: เหลือ 20, จ่าย 15 สองรอบพร้อมกัน → สำเร็จแค่ 1 ---
const [c1, c2] = await Promise.all([
  req('POST', '/api/inventory/issues',
    { productId: P, warehouseId: W, qty: 15, refDocId: 'TST-RACE-A' }, wh),
  req('POST', '/api/inventory/issues',
    { productId: P, warehouseId: W, qty: 15, refDocId: 'TST-RACE-B' }, wh),
]);
const okCount = [c1, c2].filter((r) => r.status === 201).length;
const rejCount = [c1, c2].filter((r) => r.status === 422).length;
bal = (await req('GET', `/api/inventory/balances?productId=${P}`, null, wh))
  .data[0];
check(
  '2.5 ยิงจ่าย 15 พร้อมกัน 2 request → สำเร็จ 1 โดน reject 1',
  okCount === 1 && rejCount === 1,
  `201=${okCount}, 422=${rejCount}`,
);
check(
  '2.5 ยอดเหลือ 5 (ไม่ใช่ -10)',
  Number(bal?.qtyOnHand) === 5,
  `qty=${bal?.qtyOnHand}`,
);

// --- 2.6 ปรับยอด: นับจริงได้ 3 → ADJUST_OUT -2 ---
const adj = await req(
  'POST',
  '/api/inventory/adjustments',
  { productId: P, warehouseId: W, actualQty: 3, reason: 'STK-TEST-1' },
  admin,
);
check(
  '2.6 นับจริง 3 จากระบบ 5 → ADJUST_OUT qty -2',
  adj.status === 201 &&
    adj.data?.movementType === 'ADJUST_OUT' &&
    Number(adj.data?.qty) === -2,
);
const adjByWh = await req(
  'POST',
  '/api/inventory/adjustments',
  { productId: P, warehouseId: W, actualQty: 99, reason: 'STK-HACK' },
  wh,
);
check('2.6 WAREHOUSE ปรับยอดเอง → 403 (ต้อง MANAGER ขึ้นไป)', adjByWh.status === 403);

// --- 2.6 reversal: กลับรายการ adjustment แล้วยอดกลับมา 5 และของเดิมยังอยู่ ---
const rev = await req(
  'POST',
  `/api/inventory/movements/${adj.data.id}/reverse`,
  null,
  admin,
);
check('2.6 กลับรายการได้ (REVERSAL +2)', rev.status === 201 && Number(rev.data?.qty) === 2);
const revTwice = await req(
  'POST',
  `/api/inventory/movements/${adj.data.id}/reverse`,
  null,
  admin,
);
check('2.6 กลับรายการซ้ำ → 409', revTwice.status === 409);
bal = (await req('GET', `/api/inventory/balances?productId=${P}`, null, wh)).data[0];
check('2.6 ยอดกลับมา 5 หลัง reversal', Number(bal?.qtyOnHand) === 5);

// --- 2.7 stock card: ไล่ยอดสะสมต้องตรงทุกบรรทัด ---
const card = (
  await req(
    'GET',
    `/api/inventory/stock-card?productId=${P}&warehouseId=${W}`,
    null,
    wh,
  )
).data;
// คาดหวัง: +10, +10, -15 (ตัวที่ชนะ race), -2 (adjust), +2 (reversal) → ปิดที่ 5
let running = 0;
let allMatch = true;
for (const e of card.entries) {
  running += Number(e.qty);
  if (running !== Number(e.balance)) allMatch = false;
}
check(
  '2.7 stock card running balance ตรงทุกบรรทัด ปิดที่ 5',
  allMatch && Number(card.closingQty) === 5 && card.entries.length === 5,
  `${card.entries.length} รายการ ปิด ${card.closingQty}`,
);
check(
  '2.7 movement เดิมที่ถูก reverse ยังอยู่ใน ledger (ไม่ถูกลบ)',
  card.entries.some((e) => e.id === adj.data.id),
);

// --- 2.8 reconcile: ตอนนี้ต้อง clean / แกล้งแก้ cache ต้องจับได้ ---
const rec1 = (await req('GET', '/api/inventory/reconcile', null, admin)).data;
check('2.8 reconcile clean หลังใช้งานปกติ', rec1.clean === true);

// --- 2.9 barcode lookup มียอดคงเหลือ (สินค้าหลายหน่วยที่สร้างใหม่ทุกรอบ) ---
const steelSku = `P2-STL-${Date.now()}`;
const steel = (
  await req(
    'POST',
    '/api/products',
    {
      sku: steelSku,
      name: 'เหล็กเส้นทดสอบเฟส 2',
      baseUomId: uomsAll.find((u) => u.code === 'BAR').id,
      units: [
        {
          uomId: uomsAll.find((u) => u.code === 'BUNDLE').id,
          conversionFactor: 10,
          salePrice: 520,
        },
      ],
    },
    admin,
  )
).data;
const bundleUnitId = steel.units[0].id;
await req('POST', `/api/products/${steel.id}/barcodes`, {}, admin); // QR หน่วยฐาน
await req(
  'POST',
  `/api/products/${steel.id}/barcodes`,
  { productUnitId: bundleUnitId },
  admin,
); // QR หน่วยมัด

const scan = (
  await req('GET', `/api/products/by-barcode/INT:${steelSku}:BUNDLE`, null, wh)
).data;
check(
  '2.9 by-barcode มีข้อมูล stock (ยังไม่มี movement → ว่าง)',
  Array.isArray(scan.stock) && scan.stock.length === 0,
);
// รับเหล็ก 120 เส้น แล้วยิง barcode มัด → ต้องเห็น 12 มัด
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: steel.id, warehouseId: W, qty: 120, unitCost: 45, refDocId: 'TST-STL' },
  wh,
);
const scan2 = (
  await req('GET', `/api/products/by-barcode/INT:${steelSku}:BUNDLE`, null, wh)
).data;
check(
  '2.9 รับเหล็ก 120 เส้น → ยิง QR มัดเห็น 120 เส้น = 12 มัด',
  Number(scan2.stock?.[0]?.qtyOnHand) === 120 &&
    Number(scan2.stock?.[0]?.qtyInScannedUnit) === 12,
  `base=${scan2.stock?.[0]?.qtyOnHand} scanned=${scan2.stock?.[0]?.qtyInScannedUnit}`,
);

// --- ledger คือ append-only: ไม่มี endpoint แก้/ลบ movement ---
const tryPatch = await req('PATCH', `/api/inventory/movements/${adj.data.id}`, { qty: 999 }, admin);
const tryDelete = await req('DELETE', `/api/inventory/movements/${adj.data.id}`, null, admin);
check(
  '2.1 ไม่มีทางแก้/ลบ movement ผ่าน API (404 ทั้งคู่)',
  tryPatch.status === 404 && tryDelete.status === 404,
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
