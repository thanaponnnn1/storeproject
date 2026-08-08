// ทดสอบเกณฑ์ ✔ ของเฟส 1 (Master Data) ตาม STEPS.md
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

// --- 1.1 UoM + Category ---
const uoms = await req('GET', '/api/uoms', null, admin);
check(
  '1.1 seed UoM ครบ (ชิ้น/เส้น/มัด/เมตร/ม้วน/ถุง/กระป๋อง/ลัง/เครื่อง)',
  uoms.status === 200 && uoms.data?.length >= 9,
  `ได้ ${uoms.data?.length} หน่วย`,
);
const cats = await req('GET', '/api/categories', null, admin);
check('1.1 หมวดสินค้า 3 หมวด', cats.status === 200 && cats.data?.length >= 3);

// สร้าง+แก้ UoM ผ่าน API
const newUom = await req(
  'POST',
  '/api/uoms',
  { code: `SET${Date.now().toString().slice(-6)}`, name: 'ชุดทดสอบ' },
  admin,
);
check('1.1 สร้าง UoM ใหม่ได้', newUom.status === 201);
const patched = await req(
  'PATCH',
  `/api/uoms/${newUom.data?.id}`,
  { isActive: false },
  admin,
);
check('1.1 soft delete (is_active=false) ได้', patched.status === 200);

// --- 1.2 Warehouse ---
const whs = await req('GET', '/api/warehouses', null, admin);
check(
  '1.2 มีคลัง WH-MAIN',
  whs.status === 200 && whs.data?.some((w) => w.code === 'WH-MAIN'),
);

// --- 1.3 Product ---
// ค้นด้วยรหัสสินค้าบางส่วน
const searchSku = await req('GET', '/api/products?search=STL-RB9', null, admin);
check(
  '1.3 ค้นหาจากรหัสสินค้าเจอ',
  searchSku.status === 200 &&
    searchSku.data?.data?.some((p) => p.sku === 'STL-RB9'),
);
// ค้นด้วยชื่อภาษาไทยบางส่วน — ทุกผลลัพธ์ต้องเกี่ยวข้องจริง
const search = await req('GET', '/api/products?search=เหล็ก&limit=100', null, admin);
check(
  '1.3 ค้นหาชื่อภาษาไทยบางส่วน "เหล็ก" → เจอ และทุกผลลัพธ์มีคำนี้จริง',
  search.status === 200 &&
    search.data?.data?.length > 0 &&
    search.data.data.every((p) =>
      `${p.sku} ${p.name} ${p.brand ?? ''}`.includes('เหล็ก'),
    ),
  `เจอ ${search.data?.data?.length} รายการ`,
);
const uomEA = uoms.data.find((u) => u.code === 'EA');
const dupSku = await req(
  'POST',
  '/api/products',
  { sku: 'AC-DK-12K', name: 'ซ้ำ', baseUomId: uomEA.id },
  admin,
);
check('1.3 SKU ซ้ำ → 409', dupSku.status === 409);

const acList = await req('GET', '/api/products?search=AC-DK-12K', null, admin);
const ac = acList.data?.data?.[0];
check(
  '1.3 แอร์เป็น SERIAL + ประกัน 12 เดือน + ราคา 3 ระดับ',
  ac?.trackingType === 'SERIAL' &&
    ac?.warrantyMonths === 12 &&
    Number(ac?.priceContractor) === 14200,
);
const cemList = await req('GET', '/api/products?search=CEM-TPI', null, admin);
check(
  '1.3 ปูนเป็น LOT + FIFO',
  cemList.data?.data?.[0]?.trackingType === 'LOT' &&
    cemList.data?.data?.[0]?.costingMethod === 'FIFO',
);

// --- 1.4 แปลงหน่วย ---
const steel = (await req('GET', '/api/products?search=STL-RB9', null, admin))
  .data.data[0];
const uomBundle = uoms.data.find((u) => u.code === 'BUNDLE');
const conv = await req(
  'POST',
  `/api/products/${steel.id}/convert`,
  { uomId: uomBundle.id, qty: 2 },
  admin,
);
check(
  '1.4 แปลง 2 มัด → 20 เส้น',
  conv.status === 201 && Number(conv.data?.baseQty) === 20,
  `ได้ ${conv.data?.baseQty}`,
);

// --- 1.5 barcode ---
const scanBundle = await req(
  'GET',
  '/api/products/by-barcode/INT:STL-RB9:BUNDLE',
  null,
  wh,
);
check(
  '1.5 ยิง QR มัดเหล็ก → หน่วยมัด ตัวคูณ 10',
  scanBundle.status === 200 &&
    scanBundle.data?.scannedUnit?.uom?.code === 'BUNDLE' &&
    Number(scanBundle.data?.scannedUnit?.conversionFactor) === 10,
);
const scanBase = await req(
  'GET',
  '/api/products/by-barcode/INT:STL-RB9:BAR',
  null,
  wh,
);
check(
  '1.5 ยิง QR เส้นเหล็ก → หน่วยฐาน ตัวคูณ 1',
  scanBase.status === 200 &&
    Number(scanBase.data?.scannedUnit?.conversionFactor) === 1,
);
const scanRoll = await req(
  'GET',
  '/api/products/by-barcode/8850000000066',
  null,
  wh,
);
check(
  '1.5 ยิง barcode ม้วนสายไฟ → หน่วยม้วน ×100',
  scanRoll.status === 200 &&
    scanRoll.data?.scannedUnit?.uom?.code === 'ROLL' &&
    Number(scanRoll.data?.scannedUnit?.conversionFactor) === 100,
);
const t0 = Date.now();
const notFound = await req('GET', '/api/products/by-barcode/0000000000000', null, wh);
const ms = Date.now() - t0;
check(`1.5 barcode ไม่มี → 404 ใน <100ms (${ms}ms)`, notFound.status === 404 && ms < 100);

// --- 1.6 Partner ---
const customers = await req('GET', '/api/partners?type=CUSTOMER', null, admin);
check(
  '1.6 filter type=CUSTOMER ได้เฉพาะลูกค้า',
  customers.status === 200 &&
    customers.data?.data?.length >= 3 &&
    customers.data.data.every((p) => p.type === 'CUSTOMER'),
);
check(
  '1.6 ช่างสมชายได้ราคาช่าง (CONTRACTOR)',
  customers.data?.data?.some(
    (p) => p.code === 'C-0002' && p.priceLevel === 'CONTRACTOR',
  ),
);

// --- RBAC: warehouse สร้างสินค้าไม่ได้ ---
const whCreate = await req(
  'POST',
  '/api/products',
  { sku: 'X-TEST', name: 'ทดสอบสิทธิ์', baseUomId: uomEA.id },
  wh,
);
check('RBAC: WAREHOUSE สร้างสินค้า → 403', whCreate.status === 403);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
