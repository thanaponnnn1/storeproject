// ทดสอบเกณฑ์ ✔ ของเฟส 3 (FIFO) + regression เฟส 2 ตาม STEPS.md
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

const W = (await req('GET', '/api/warehouses', null, admin)).data.find(
  (w) => w.code === 'WH-MAIN',
).id;
const uoms = (await req('GET', '/api/uoms', null, admin)).data;
const uomBag = uoms.find((u) => u.code === 'BAG').id;

// สร้างสินค้า FIFO ใหม่สำหรับเทสนี้ (SKU ไม่ซ้ำต่อรอบ)
const sku = `FIFO-TEST-${Date.now()}`;
const created = await req(
  'POST',
  '/api/products',
  {
    sku,
    name: 'สินค้าทดสอบ FIFO',
    baseUomId: uomBag,
    costingMethod: 'FIFO',
    priceRetail: 200,
  },
  admin,
);
check('สร้างสินค้า costingMethod=FIFO ได้', created.status === 201);
const P = created.data.id;

// --- 3.3 รับ 3 ล็อตราคาต่างกัน → มี 3 layers เรียงตามเวลา ---
for (const [qty, cost, ref] of [
  [10, 100, 'FIFO-R1'],
  [10, 120, 'FIFO-R2'],
  [10, 150, 'FIFO-R3'],
]) {
  await req(
    'POST',
    '/api/inventory/receipts',
    { productId: P, warehouseId: W, qty, unitCost: cost, refDocId: ref },
    wh,
  );
}
let layers = (
  await req('GET', `/api/inventory/cost-layers?productId=${P}`, null, admin)
).data;
check(
  '3.3 รับ 3 ล็อต → มี 3 layers เรียงตาม received_at + remaining เต็ม',
  layers.length === 3 &&
    layers.every((l) => Number(l.remainingQty) === 10) &&
    layers.map((l) => Number(l.unitCost)).join(',') === '100,120,150',
  layers.map((l) => `${l.remainingQty}@${Number(l.unitCost)}`).join(' | '),
);

// --- 3.4 จ่าย 25 คร่อม layer → ทุนต้อง 2,950 ---
const issue = await req(
  'POST',
  '/api/inventory/issues',
  { productId: P, warehouseId: W, qty: 25, refDocId: 'FIFO-ISSUE-25' },
  wh,
);
check(
  '3.4 จ่าย 25 → totalCost = 2,950 (10×100 + 10×120 + 5×150)',
  issue.status === 201 && Math.abs(Number(issue.data?.totalCost)) === 2950,
  `totalCost=${issue.data?.totalCost}`,
);
check(
  '3.4 ทุนต่อหน่วยถ่วงน้ำหนัก = 118',
  Number(issue.data?.unitCost) === 118,
  `unitCost=${issue.data?.unitCost}`,
);

layers = (
  await req('GET', `/api/inventory/cost-layers?productId=${P}`, null, admin)
).data;
check(
  '3.4 layer 1,2 หมด / layer 3 เหลือ 5',
  Number(layers[0].remainingQty) === 0 &&
    Number(layers[1].remainingQty) === 0 &&
    Number(layers[2].remainingQty) === 5,
  layers.map((l) => l.remainingQty).join(','),
);
check(
  '3.4 บันทึก consumption ครบ 3 ก้อน (ตรวจต้นทุนย้อนหลังได้)',
  layers[0].consumptions.length === 1 &&
    layers[1].consumptions.length === 1 &&
    layers[2].consumptions.length === 1 &&
    Number(layers[2].consumptions[0].qty) === 5,
);

// --- 3.4 จ่ายต่อจาก layer ที่เหลือ: จ่าย 5 → ทุน 750 ทั้งก้อนที่ 3 ---
const issue2 = await req(
  'POST',
  '/api/inventory/issues',
  { productId: P, warehouseId: W, qty: 5, refDocId: 'FIFO-ISSUE-5' },
  wh,
);
check(
  '3.4 จ่าย 5 ที่เหลือ → ทุน 750 @150 (ของแพงสุดออกท้ายสุด)',
  Number(issue2.data?.unitCost) === 150 &&
    Math.abs(Number(issue2.data?.totalCost)) === 750,
);

// --- จ่ายเกินยอด (ไม่มีของแล้ว) → 422 ---
const over = await req(
  'POST',
  '/api/inventory/issues',
  { productId: P, warehouseId: W, qty: 1, refDocId: 'FIFO-OVER' },
  wh,
);
check('FIFO: จ่ายเกินยอด → 422 (กันติดลบเหมือนเดิม)', over.status === 422);

// --- 3.5 reversal จ่ายออก → layer กลับสภาพเดิม ---
const rev = await req(
  'POST',
  `/api/inventory/movements/${issue2.data.id}/reverse`,
  null,
  admin,
);
check('3.5 กลับรายการการจ่ายได้', rev.status === 201);
layers = (
  await req('GET', `/api/inventory/cost-layers?productId=${P}`, null, admin)
).data;
check(
  '3.5 layer 3 ได้ qty คืน 5 (สภาพเดิมเป๊ะ)',
  Number(layers[2].remainingQty) === 5,
  `remaining=${layers[2].remainingQty}`,
);
// layer 3 ถูกกิน 5 (จ่าย 25) + 5 (จ่าย 5) แล้วคืน -5 (reversal) = 3 แถว เหลือ 5
const l3sum = layers[2].consumptions.reduce((s, c) => s + Number(c.qty), 0);
check(
  '3.5 consumption ตัวเดิมยังอยู่ + มีแถวกลับรายการ qty ติดลบ (append-only)',
  layers[2].consumptions.length === 3 &&
    layers[2].consumptions.some((c) => Number(c.qty) === -5) &&
    Number(layers[2].originalQty) - l3sum === Number(layers[2].remainingQty),
  `${layers[2].consumptions.length} แถว, original ${layers[2].originalQty} - consumed ${l3sum} = ${layers[2].remainingQty}`,
);

// --- 3.5 reversal รับเข้าที่ถูกจ่ายไปแล้ว → ต้องปฏิเสธ ---
const firstReceive = (
  await req(
    'GET',
    `/api/inventory/movements?productId=${P}&refDocType=MANUAL&limit=100`,
    null,
    admin,
  )
).data.data.find((m) => m.refDocId === 'FIFO-R1');
const revReceive = await req(
  'POST',
  `/api/inventory/movements/${firstReceive.id}/reverse`,
  null,
  admin,
);
check(
  '3.5 กลับรายการรับเข้าที่ของถูกจ่ายไปแล้ว → 422 (กันประวัติต้นทุนเสียหาย)',
  revReceive.status === 422,
  revReceive.data?.message,
);

// --- 3.5 reversal รับเข้าที่ยังไม่ถูกแตะ → ได้ และ layer ปิด ---
const untouched = await req(
  'POST',
  '/api/inventory/receipts',
  { productId: P, warehouseId: W, qty: 7, unitCost: 999, refDocId: 'FIFO-R4' },
  wh,
);
const revUntouched = await req(
  'POST',
  `/api/inventory/movements/${untouched.data.id}/reverse`,
  null,
  admin,
);
check(
  '3.5 กลับรายการรับเข้าที่ยังไม่ถูกจ่าย → สำเร็จ',
  revUntouched.status === 201,
);
layers = (
  await req('GET', `/api/inventory/cost-layers?productId=${P}`, null, admin)
).data;
const l4 = layers.find((l) => Number(l.unitCost) === 999);
check(
  '3.5 layer ที่ถูกยกเลิกเหลือ 0 และมี consumption ปิดก้อน',
  Number(l4.remainingQty) === 0 && l4.consumptions.length === 1,
);

// --- 3.5 layer guard จริง: ล็อตถูกกินบางส่วน แต่ balance ยังไม่ติดลบ ---
const skuG = `FIFO-GUARD-${Date.now()}`;
const gProd = await req(
  'POST',
  '/api/products',
  { sku: skuG, name: 'ทดสอบ layer guard', baseUomId: uomBag, costingMethod: 'FIFO' },
  admin,
);
const PG = gProd.data.id;
const gR1 = await req(
  'POST',
  '/api/inventory/receipts',
  { productId: PG, warehouseId: W, qty: 10, unitCost: 100, refDocId: 'G-R1' },
  wh,
);
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: PG, warehouseId: W, qty: 10, unitCost: 200, refDocId: 'G-R2' },
  wh,
);
await req(
  'POST',
  '/api/inventory/issues',
  { productId: PG, warehouseId: W, qty: 5, refDocId: 'G-I1' },
  wh,
); // กิน 5 จากล็อตแรก
const guardRev = await req(
  'POST',
  `/api/inventory/movements/${gR1.data.id}/reverse`,
  null,
  admin,
);
check(
  '3.5 layer guard: ยอดคงเหลือพอ (15) แต่ล็อตถูกกินไป 5 → 422 ด้วยข้อความเรื่องล็อต',
  guardRev.status === 422 && /ล็อตนี้ถูกจ่ายออกไปบางส่วน/.test(guardRev.data?.message ?? ''),
  guardRev.data?.message,
);

// --- ยอดยกมา: สินค้า AVG ที่มีของอยู่ สลับเป็น FIFO → ต้องได้ opening layer ---
const skuSw = `SWITCH-${Date.now()}`;
const swProd = await req(
  'POST',
  '/api/products',
  { sku: skuSw, name: 'ทดสอบสลับ AVG→FIFO', baseUomId: uomBag },
  admin,
);
const PS = swProd.data.id;
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: PS, warehouseId: W, qty: 10, unitCost: 100, refDocId: 'SW-R1' },
  wh,
);
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: PS, warehouseId: W, qty: 10, unitCost: 200, refDocId: 'SW-R2' },
  wh,
);
await req('PATCH', `/api/products/${PS}`, { costingMethod: 'FIFO' }, admin);
const swLayers = (
  await req('GET', `/api/inventory/cost-layers?productId=${PS}`, null, admin)
).data;
check(
  'สลับ AVG→FIFO ตอนมีของ 20 → สร้าง opening layer 20 @ทุนเฉลี่ย 150',
  swLayers.length === 1 &&
    swLayers[0].isOpening === true &&
    Number(swLayers[0].remainingQty) === 20 &&
    Number(swLayers[0].unitCost) === 150,
  swLayers.map((l) => `${l.remainingQty}@${Number(l.unitCost)} opening=${l.isOpening}`).join(),
);
const swIssue = await req(
  'POST',
  '/api/inventory/issues',
  { productId: PS, warehouseId: W, qty: 8, refDocId: 'SW-I1' },
  wh,
);
check(
  'หลังสลับเป็น FIFO จ่ายออกได้จริง (ทุน 150 × 8 = 1,200)',
  swIssue.status === 201 && Math.abs(Number(swIssue.data?.totalCost)) === 1200,
  `totalCost=${swIssue.data?.totalCost}`,
);

// --- backfill ข้อมูลเก่าที่มีก่อนระบบ FIFO ---
const backfill = await req(
  'POST',
  '/api/inventory/cost-layers/backfill',
  null,
  admin,
);
check('backfill ยอดยกมาให้สินค้า FIFO ที่ layer ไม่ครบ สำเร็จ', backfill.status === 201);

// --- reconcile ต้อง clean (ตรวจทั้ง balance และ cost layer) ---
const rec = (await req('GET', '/api/inventory/reconcile', null, admin)).data;
check(
  'reconcile clean — ผลรวม layer ตรงกับยอดคงเหลือทุกสินค้า FIFO',
  rec.clean === true,
  JSON.stringify(rec.mismatches),
);

// --- 3.2 regression: สินค้า AVG ยังคิดทุนเฉลี่ยเหมือนเดิม ---
const skuAvg = `AVG-TEST-${Date.now()}`;
const avgProd = await req(
  'POST',
  '/api/products',
  { sku: skuAvg, name: 'สินค้าทดสอบ AVG', baseUomId: uomBag },
  admin,
);
const PA = avgProd.data.id;
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: PA, warehouseId: W, qty: 10, unitCost: 100, refDocId: 'AVG-R1' },
  wh,
);
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: PA, warehouseId: W, qty: 10, unitCost: 200, refDocId: 'AVG-R2' },
  wh,
);
const balAvg = (
  await req('GET', `/api/inventory/balances?productId=${PA}`, null, wh)
).data.data[0];
check(
  '3.2 regression AVG: 10@100 + 10@200 → avg ยังเป็น 150',
  Number(balAvg.avgCost) === 150,
  `avg=${balAvg.avgCost}`,
);
const issueAvg = await req(
  'POST',
  '/api/inventory/issues',
  { productId: PA, warehouseId: W, qty: 5, refDocId: 'AVG-I1' },
  wh,
);
check(
  '3.2 regression AVG: จ่าย 5 ที่ทุน 150 → 750',
  Number(issueAvg.data?.unitCost) === 150 &&
    Math.abs(Number(issueAvg.data?.totalCost)) === 750,
);
const layersAvg = (
  await req('GET', `/api/inventory/cost-layers?productId=${PA}`, null, admin)
).data;
check(
  '3.2 สินค้า AVG ไม่สร้าง cost layer (ไม่มี overhead)',
  layersAvg.length === 0,
);

// --- สลับ method รายสินค้าได้ ---
const switched = await req(
  'PATCH',
  `/api/products/${PA}`,
  { costingMethod: 'FIFO' },
  admin,
);
check(
  'สลับ costingMethod รายสินค้าได้ (AVG → FIFO)',
  switched.status === 200 && switched.data?.costingMethod === 'FIFO',
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
