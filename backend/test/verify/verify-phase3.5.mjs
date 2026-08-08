// ทดสอบเกณฑ์ ✔ ของเฟส 3.5 (Serial & Lot Tracking) ตาม STEPS.md
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
const uomEA = uoms.find((u) => u.code === 'EA').id;
const uomBag = uoms.find((u) => u.code === 'BAG').id;
const customer = (
  await req('GET', '/api/partners?type=CUSTOMER', null, admin)
).data.data.find((p) => p.code === 'C-0002'); // ช่างสมชาย

const stamp = Date.now();

// ============ SERIAL: แอร์ ============
const ac = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `AC-TEST-${stamp}`,
      name: 'แอร์ทดสอบ 12000 BTU',
      brand: 'Daikin',
      baseUomId: uomEA,
      trackingType: 'SERIAL',
      warrantyMonths: 12,
      priceRetail: 14900,
    },
    admin,
  )
).data;

// --- 3.5.1 รับเข้าต้องยิง serial ครบทุกเครื่อง ---
const S = (n) => `SN-${stamp}-${n}`;
const recvNoSerial = await req(
  'POST',
  '/api/inventory/receipts',
  { productId: ac.id, warehouseId: W, qty: 3, unitCost: 12000, refDocId: 'AC-GR1' },
  wh,
);
check(
  '3.5.1 รับแอร์โดยไม่คีย์ serial → 422',
  recvNoSerial.status === 422,
  recvNoSerial.data?.message,
);

const recvShort = await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 3,
    unitCost: 12000,
    refDocId: 'AC-GR1',
    serials: [S(1), S(2)],
  },
  wh,
);
check(
  '3.5.1 รับ 3 เครื่องแต่ส่ง serial 2 ตัว → 422',
  recvShort.status === 422,
  recvShort.data?.message,
);

const recvDup = await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 2,
    unitCost: 12000,
    refDocId: 'AC-GR1',
    serials: [S(1), S(1)],
  },
  wh,
);
check('3.5.1 serial ซ้ำกันในรายการเดียว → 400', recvDup.status === 400);

const recvOk = await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 3,
    unitCost: 12000,
    refDocId: 'AC-GR1',
    serials: [S(1), S(2), S(3)],
  },
  wh,
);
check('3.5.1 รับแอร์ 3 เครื่อง + serial 3 ตัว → สำเร็จ', recvOk.status === 201);

const recvDupDb = await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 1,
    unitCost: 12000,
    refDocId: 'AC-GR2',
    serials: [S(1)],
  },
  wh,
);
check('3.5.1 serial ที่มีในระบบแล้ว → 409', recvDupDb.status === 409);

const serialsInStock = (
  await req(`GET`, `/api/inventory/serials?productId=${ac.id}`, null, wh)
).data;
check(
  '3.5.1 serial 3 ตัวอยู่ในสถานะ IN_STOCK',
  serialsInStock.meta.total === 3 &&
    serialsInStock.data.every((s) => s.status === 'IN_STOCK'),
);

// --- 3.5.2 จ่ายออกต้องเลือก serial + คำนวณวันหมดประกัน ---
const issueBad = await req(
  'POST',
  '/api/inventory/issues',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 1,
    refDocId: 'AC-DO1',
    serials: ['SN-NOT-EXIST'],
  },
  wh,
);
check('3.5.2 จ่าย serial ที่ไม่มีในระบบ → 422', issueBad.status === 422);

const issueOk = await req(
  'POST',
  '/api/inventory/issues',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 1,
    refDocId: 'AC-DO1',
    serials: [S(1)],
    soldToPartnerId: customer.id,
  },
  wh,
);
check('3.5.2 จ่ายแอร์ 1 เครื่องพร้อมระบุ serial + ลูกค้า → สำเร็จ', issueOk.status === 201);

const issueSold = await req(
  'POST',
  '/api/inventory/issues',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 1,
    refDocId: 'AC-DO2',
    serials: [S(1)],
  },
  wh,
);
check('3.5.2 จ่าย serial ที่ขายไปแล้ว → 422', issueSold.status === 422);

// --- 3.5.3 หน้าเช็คประกัน ---
const claim = (await req('GET', `/api/inventory/serials/${S(1)}`, null, wh)).data;
const expectedEnd = new Date(claim.soldAt);
expectedEnd.setMonth(expectedEnd.getMonth() + 12);
check(
  '3.5.3 ยิง serial ที่ขายแล้ว → รู้สินค้า/วันขาย/ลูกค้า/ประกันเหลือ',
  claim.status === 'SOLD' &&
    claim.product.sku === ac.sku &&
    claim.soldToPartner?.code === 'C-0002' &&
    claim.warranty.inWarranty === true &&
    claim.warranty.daysLeft > 300,
  `ประกันเหลือ ${claim.warranty?.daysLeft} วัน ถึง ${claim.warranty?.endAt}`,
);
check(
  '3.5.3 วันหมดประกัน = วันขาย + 12 เดือน',
  new Date(claim.warranty.endAt).toDateString() === expectedEnd.toDateString(),
);
const claimStock = (await req('GET', `/api/inventory/serials/${S(2)}`, null, wh))
  .data;
check(
  '3.5.3 serial ที่ยังไม่ขาย → ยังไม่เริ่มนับประกัน',
  claimStock.status === 'IN_STOCK' && claimStock.warranty.inWarranty === false,
);
const claim404 = await req('GET', '/api/inventory/serials/NOT-A-SERIAL', null, wh);
check('3.5.3 serial ไม่มีในระบบ → 404', claim404.status === 404);

// --- 3.5.5 reversal คืน serial ---
const revIssue = await req(
  'POST',
  `/api/inventory/movements/${issueOk.data.id}/reverse`,
  null,
  admin,
);
check('3.5.5 กลับรายการการจ่ายแอร์ได้', revIssue.status === 201);
const afterRev = (await req('GET', `/api/inventory/serials/${S(1)}`, null, wh))
  .data;
check(
  '3.5.5 serial กลับเป็น IN_STOCK + ล้างข้อมูลขาย/ประกัน',
  afterRev.status === 'IN_STOCK' &&
    afterRev.soldAt === null &&
    afterRev.warrantyEnd === null &&
    afterRev.soldToPartnerId === null,
);

// รับใหม่ 1 เครื่อง แล้วยกเลิกการรับ → serial หายไป (คีย์ผิดแล้วทำใหม่ได้)
const recvTmp = await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 1,
    unitCost: 12000,
    refDocId: 'AC-GR3',
    serials: [S(99)],
  },
  wh,
);
const revRecv = await req(
  'POST',
  `/api/inventory/movements/${recvTmp.data.id}/reverse`,
  null,
  admin,
);
check('3.5.5 กลับรายการการรับเข้าที่ยังไม่ขาย → สำเร็จ', revRecv.status === 201);
const goneSerial = await req('GET', `/api/inventory/serials/${S(99)}`, null, wh);
check('3.5.5 serial ที่ยกเลิกการรับหายจากระบบ (คีย์ใหม่ได้)', goneSerial.status === 404);

// ยกเลิกการรับที่ของถูกขายไปแล้ว → ต้องปฏิเสธด้วย serial guard
// (รับล็อตที่สองเพิ่มเพื่อให้ยอดคงเหลือยังพอ พิสูจน์ว่า guard ชั้น serial ทำงานจริง
//  ไม่ได้ผ่านเพราะด่านยอดติดลบดักไว้ก่อน)
await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 3,
    unitCost: 12000,
    refDocId: 'AC-GR4',
    serials: [S(11), S(12), S(13)],
  },
  wh,
);
await req(
  'POST',
  '/api/inventory/issues',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 1,
    refDocId: 'AC-DO3',
    serials: [S(3)], // เครื่องจากใบรับ GR1
    soldToPartnerId: customer.id,
  },
  wh,
);
const balBefore = (
  await req('GET', `/api/inventory/balances?productId=${ac.id}`, null, wh)
).data.data[0];
const revRecvSold = await req(
  'POST',
  `/api/inventory/movements/${recvOk.data.id}/reverse`,
  null,
  admin,
);
check(
  '3.5.5 ยกเลิกใบรับที่มีเครื่องถูกขายแล้ว → 422 ระบุ serial ที่ติดปัญหา (ยอดคงเหลือยังพอ)',
  revRecvSold.status === 422 &&
    revRecvSold.data?.message?.includes(S(3)) &&
    Number(balBefore.qtyOnHand) >= 3,
  `ยอดคงเหลือ ${balBefore?.qtyOnHand} — ${revRecvSold.data?.message}`,
);

// ============ LOT: ปูน (LOT + FIFO) ============
const cem = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `CEM-TEST-${stamp}`,
      name: 'ปูนทดสอบ 50 กก.',
      baseUomId: uomBag,
      trackingType: 'LOT',
      costingMethod: 'FIFO',
      priceRetail: 135,
    },
    admin,
  )
).data;

// --- 3.5.4 รับเข้าต้องระบุ lot + วันหมดอายุ ---
const cemNoLot = await req(
  'POST',
  '/api/inventory/receipts',
  { productId: cem.id, warehouseId: W, qty: 100, unitCost: 110, refDocId: 'CEM-GR1' },
  wh,
);
check('3.5.4 รับปูนโดยไม่ระบุล็อต → 400', cemNoLot.status === 400);

const day = 86_400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
// ล็อต A รับก่อน แต่หมดอายุทีหลัง / ล็อต B รับทีหลัง แต่ใกล้หมดอายุกว่า
await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: cem.id,
    warehouseId: W,
    qty: 100,
    unitCost: 110,
    refDocId: 'CEM-GR1',
    lotNo: 'LOT-A',
    expiryDate: iso(90 * day),
  },
  wh,
);
await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: cem.id,
    warehouseId: W,
    qty: 50,
    unitCost: 125,
    refDocId: 'CEM-GR2',
    lotNo: 'LOT-B',
    expiryDate: iso(20 * day),
  },
  wh,
);

const lots = (
  await req('GET', `/api/inventory/lots?productId=${cem.id}`, null, wh)
).data;
check(
  '3.5.4 ยอดคงเหลือแยกราย lot ถูกต้อง (A=100, B=50)',
  lots.length === 2 &&
    Number(lots.find((l) => l.lotNo === 'LOT-A').remainingQty) === 100 &&
    Number(lots.find((l) => l.lotNo === 'LOT-B').remainingQty) === 50,
);
check(
  '3.5.4 FEFO: ระบบแนะนำ LOT-B ก่อน (ใกล้หมดอายุกว่า แม้รับทีหลัง)',
  lots[0].lotNo === 'LOT-B' && lots[0].daysToExpiry < lots[1].daysToExpiry,
  `แนะนำ ${lots.map((l) => `${l.lotNo}(${l.daysToExpiry}วัน)`).join(' → ')}`,
);

const issueNoLot = await req(
  'POST',
  '/api/inventory/issues',
  { productId: cem.id, warehouseId: W, qty: 10, refDocId: 'CEM-DO1' },
  wh,
);
check('3.5.4 จ่ายปูนโดยไม่ระบุล็อต → 400', issueNoLot.status === 400);

const lotB = lots.find((l) => l.lotNo === 'LOT-B');
const overLot = await req(
  'POST',
  '/api/inventory/issues',
  { productId: cem.id, warehouseId: W, qty: 60, refDocId: 'CEM-DO1', lotId: lotB.id },
  wh,
);
check(
  '3.5.4 จ่ายเกินยอดของล็อตนั้น (60 จาก 50) → 422 แม้ยอดรวมพอ',
  overLot.status === 422 && /ล็อต LOT-B คงเหลือ 50/.test(overLot.data?.message ?? ''),
  overLot.data?.message,
);

// จ่ายจาก LOT-B → ต้นทุนต้องเป็นของ LOT-B (125) ไม่ใช่ล็อตที่รับก่อน (110)
const issueLotB = await req(
  'POST',
  '/api/inventory/issues',
  { productId: cem.id, warehouseId: W, qty: 20, refDocId: 'CEM-DO1', lotId: lotB.id },
  wh,
);
check(
  '3.5.4 จ่ายจาก LOT-B → ต้นทุนมาจากล็อตนั้น (125) ไม่ใช่ล็อตที่รับก่อน (110)',
  issueLotB.status === 201 &&
    Number(issueLotB.data.unitCost) === 125 &&
    Math.abs(Number(issueLotB.data.totalCost)) === 2500,
  `unitCost=${issueLotB.data?.unitCost} total=${issueLotB.data?.totalCost}`,
);

const lotsAfter = (
  await req('GET', `/api/inventory/lots?productId=${cem.id}`, null, wh)
).data;
check(
  '3.5.4 หลังจ่าย 20 จาก LOT-B → เหลือ 30 (A ยังครบ 100)',
  Number(lotsAfter.find((l) => l.lotNo === 'LOT-B').remainingQty) === 30 &&
    Number(lotsAfter.find((l) => l.lotNo === 'LOT-A').remainingQty) === 100,
);

const expiring = (
  await req('GET', '/api/inventory/lots/expiring?days=30', null, admin)
).data;
check(
  '3.5.4 แจ้งเตือนล็อตใกล้หมดอายุใน 30 วัน → เจอ LOT-B ไม่เจอ LOT-A',
  expiring.lots.some((l) => l.lotNo === 'LOT-B') &&
    !expiring.lots.some((l) => l.lotNo === 'LOT-A'),
  `${expiring.lots.length} ล็อต`,
);

// --- 3.5.5 reversal คืนยอด lot ---
const revLot = await req(
  'POST',
  `/api/inventory/movements/${issueLotB.data.id}/reverse`,
  null,
  admin,
);
const lotsRev = (
  await req('GET', `/api/inventory/lots?productId=${cem.id}`, null, wh)
).data;
check(
  '3.5.5 กลับรายการจ่ายปูน → LOT-B ได้ยอดคืนเป็น 50',
  revLot.status === 201 &&
    Number(lotsRev.find((l) => l.lotNo === 'LOT-B').remainingQty) === 50,
);

// --- สินค้าธรรมดาห้ามส่ง serial/lot มา ---
const plain = (
  await req(
    'POST',
    '/api/products',
    { sku: `PLAIN-${stamp}`, name: 'น็อตทดสอบ', baseUomId: uomBag },
    admin,
  )
).data;
const plainBad = await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: plain.id,
    warehouseId: W,
    qty: 5,
    unitCost: 10,
    refDocId: 'N-1',
    serials: ['X1'],
  },
  wh,
);
check('สินค้า NONE ส่ง serial มา → 400 (กันคีย์ผิดสินค้า)', plainBad.status === 400);

// --- reconcile ยังต้อง clean ---
const rec = (await req('GET', '/api/inventory/reconcile', null, admin)).data;
check('reconcile clean หลังใช้งาน serial/lot', rec.clean === true, JSON.stringify(rec.mismatches));

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
