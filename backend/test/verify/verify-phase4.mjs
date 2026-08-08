// ทดสอบเกณฑ์ ✔ ของเฟส 4 (Sales Flow: QT → SO → DO → INV → Payment) ตาม STEPS.md
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

const stamp = Date.now();
const W = (await req('GET', '/api/warehouses', null, admin)).data.find(
  (w) => w.code === 'WH-MAIN',
).id;
const uoms = (await req('GET', '/api/uoms', null, admin)).data;
const uomBar = uoms.find((u) => u.code === 'BAR').id;
const uomBundle = uoms.find((u) => u.code === 'BUNDLE').id;
const uomEA = uoms.find((u) => u.code === 'EA').id;

// ลูกค้า 3 ระดับราคา
const customers = (await req('GET', '/api/partners?type=CUSTOMER', null, admin))
  .data.data;
const retail = customers.find((p) => p.code === 'C-0001');
const contractor = customers.find((p) => p.code === 'C-0002');

// สินค้าทดสอบ: เหล็กเส้น (หลายหน่วย) + แอร์ (SERIAL)
const steel = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `P4-STL-${stamp}`,
      name: 'เหล็กเส้นทดสอบเฟส 4',
      baseUomId: uomBar,
      priceRetail: 58,
      priceContractor: 54,
      priceProject: 51,
      units: [{ uomId: uomBundle, conversionFactor: 10, salePrice: 520 }],
    },
    admin,
  )
).data;
const ac = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `P4-AC-${stamp}`,
      name: 'แอร์ทดสอบเฟส 4',
      baseUomId: uomEA,
      trackingType: 'SERIAL',
      warrantyMonths: 12,
      priceRetail: 14900,
      priceContractor: 14200,
    },
    admin,
  )
).data;

// เติมสต๊อก
await req(
  'POST',
  '/api/inventory/receipts',
  { productId: steel.id, warehouseId: W, qty: 500, unitCost: 45, refDocId: `P4-GR-${stamp}` },
  wh,
);
const SN = (n) => `P4SN-${stamp}-${n}`;
await req(
  'POST',
  '/api/inventory/receipts',
  {
    productId: ac.id,
    warehouseId: W,
    qty: 3,
    unitCost: 12000,
    refDocId: `P4-GRAC-${stamp}`,
    serials: [SN(1), SN(2), SN(3)],
  },
  wh,
);

// ============ 4.1 เลขรันเอกสาร + state machine ============
const concurrent = await Promise.all(
  Array.from({ length: 30 }, () =>
    req(
      'POST',
      '/api/quotations',
      {
        partnerId: retail.id,
        lines: [{ productId: steel.id, qty: 1 }],
      },
      admin,
    ),
  ),
);
const docNos = concurrent.filter((r) => r.status === 201).map((r) => r.data.docNo);
const uniqueNos = new Set(docNos);
const seq = docNos
  .map((n) => Number(n.split('-').pop()))
  .sort((a, b) => a - b);
const noGaps = seq.every((n, i) => i === 0 || n === seq[i - 1] + 1);
check(
  '4.1 ขอเลขเอกสาร 30 ใบพร้อมกัน → ไม่ซ้ำ ไม่โดด',
  docNos.length === 30 && uniqueNos.size === 30 && noGaps,
  `สร้าง ${docNos.length} ใบ ไม่ซ้ำ ${uniqueNos.size} ใบ เรียง ${seq[0]}..${seq[seq.length - 1]}`,
);
check(
  '4.1 รูปแบบเลขเอกสารถูกต้อง (QT-YYYY-MM-NNNN)',
  /^QT-\d{4}-\d{2}-\d{4}$/.test(docNos[0]),
  docNos[0],
);

// ============ 4.7 ราคาตามระดับลูกค้า ============
const qtRetail = (
  await req(
    'POST',
    '/api/quotations',
    {
      partnerId: retail.id,
      lines: [
        { productId: steel.id, qty: 10 },
        { productId: steel.id, productUnitId: steel.units[0].id, qty: 2 },
      ],
    },
    admin,
  )
).data;
check(
  '4.7 ลูกค้าปลีก: เส้นละ 58, ยกมัดใช้ราคาป้าย 520 (ถูกกว่า 10 เส้น)',
  Number(qtRetail.lines[0].unitPrice) === 58 &&
    Number(qtRetail.lines[1].unitPrice) === 520,
  `${qtRetail.lines[0].unitPrice} / ${qtRetail.lines[1].unitPrice}`,
);
check(
  '4.7 คำนวณ VAT 7% ถูกต้อง',
  Number(qtRetail.subtotal) === 1620 && // 10×58 + 2×520
    Number(qtRetail.vatAmount) === 113.4 &&
    Number(qtRetail.totalAmount) === 1733.4,
  `subtotal=${qtRetail.subtotal} vat=${qtRetail.vatAmount} total=${qtRetail.totalAmount}`,
);
check(
  '4.7 หน่วยมัดแปลงเป็นหน่วยฐานถูกต้อง (2 มัด = 20 เส้น)',
  Number(qtRetail.lines[1].baseQty) === 20,
);

const qtContractor = (
  await req(
    'POST',
    '/api/quotations',
    { partnerId: contractor.id, lines: [{ productId: steel.id, qty: 10 }] },
    admin,
  )
).data;
check(
  '4.7 ลูกค้าช่างได้ราคาช่างอัตโนมัติ (54)',
  Number(qtContractor.lines[0].unitPrice) === 54,
);

// พนักงานขาย (SALES) เปิดใบเสนอราคาได้ แต่แก้ราคาหน้าบิลเองไม่ได้
const salesToken = (
  await req('POST', '/api/auth/login', {
    email: 'sales@store.local',
    password: 'Admin@1234',
  })
).data.accessToken;
const salesNormal = await req(
  'POST',
  '/api/quotations',
  { partnerId: contractor.id, lines: [{ productId: steel.id, qty: 1 }] },
  salesToken,
);
check(
  '4.7 SALES เปิดใบเสนอราคาได้ และได้ราคาตามระดับลูกค้าอัตโนมัติ (54)',
  salesNormal.status === 201 &&
    Number(salesNormal.data.lines[0].unitPrice) === 54,
);
const priceOverride = await req(
  'POST',
  '/api/quotations',
  {
    partnerId: retail.id,
    lines: [{ productId: steel.id, qty: 1, unitPrice: 1 }],
  },
  salesToken,
);
check(
  '4.7 SALES แก้ราคาหน้าบิลเอง → 403 (ต้องผู้จัดการขึ้นไป)',
  priceOverride.status === 403 &&
    /แก้ราคาหน้าบิลไม่ได้/.test(priceOverride.data?.message ?? ''),
  priceOverride.data?.message,
);
const priceOverrideAdmin = await req(
  'POST',
  '/api/quotations',
  {
    partnerId: retail.id,
    lines: [{ productId: steel.id, qty: 1, unitPrice: 50 }],
  },
  admin,
);
check(
  '4.7 ADMIN แก้ราคาหน้าบิลได้',
  priceOverrideAdmin.status === 201 &&
    Number(priceOverrideAdmin.data.lines[0].unitPrice) === 50,
);

// ============ 4.2 Quotation state machine ============
const qt = (
  await req(
    'POST',
    '/api/quotations',
    {
      partnerId: contractor.id,
      lines: [
        { productId: steel.id, productUnitId: steel.units[0].id, qty: 10 }, // 10 มัด = 100 เส้น
        { productId: ac.id, qty: 2 },
      ],
    },
    admin,
  )
).data;
check('4.2 สร้างใบเสนอราคาเป็นฉบับร่าง', qt.status === 'DRAFT');

const convertDraft = await req(
  'POST',
  `/api/quotations/${qt.id}/convert`,
  { warehouseId: W },
  admin,
);
check(
  '4.2 แปลงใบเสนอราคาที่ยังไม่อนุมัติ → 422',
  convertDraft.status === 422,
  convertDraft.data?.message,
);

const badTransition = await req('PATCH', `/api/quotations/${qt.id}/approve`, null, admin);
check(
  '4.1 เปลี่ยนสถานะนอกตาราง (DRAFT → APPROVED) → 422',
  badTransition.status === 422,
  badTransition.data?.message,
);

await req('PATCH', `/api/quotations/${qt.id}/submit`, null, admin);
await req('PATCH', `/api/quotations/${qt.id}/approve`, null, admin);
const editApproved = await req(
  'PUT',
  `/api/quotations/${qt.id}`,
  { partnerId: contractor.id, lines: [{ productId: steel.id, qty: 1 }] },
  admin,
);
check(
  '4.2 แก้ใบเสนอราคาที่อนุมัติแล้ว → 422',
  editApproved.status === 422,
  editApproved.data?.message,
);

// ============ 4.3 convert → SO พร้อมลูกโซ่เอกสาร ============
const so = (
  await req('POST', `/api/quotations/${qt.id}/convert`, { warehouseId: W }, admin)
).data;
check(
  '4.3 แปลงเป็นใบสั่งขายได้ + ใบเสนอราคาเป็น CONVERTED',
  so.docNo?.startsWith('SO-') &&
    (await req('GET', `/api/quotations/${qt.id}`, null, admin)).data.status ===
      'CONVERTED',
);
const qtFull = (await req('GET', `/api/quotations/${qt.id}`, null, admin)).data;
check(
  '4.3 ทุกบรรทัดของ SO ชี้กลับบรรทัดของ QT (sourceLineId)',
  so.lines.length === 2 &&
    so.lines.every((l) => qtFull.lines.some((q) => q.id === l.sourceLineId)),
);
check(
  '4.3 ยอดเงินยกมาจากใบเสนอราคาครบ',
  Number(so.totalAmount) === Number(qtFull.totalAmount),
);

// ============ 4.4 DO + post stock ============
const soLineSteel = so.lines.find((l) => l.productId === steel.id);
const soLineAc = so.lines.find((l) => l.productId === ac.id);

const doBeforeConfirm = await req(
  'POST',
  '/api/deliveries',
  { salesOrderId: so.id, lines: [{ soLineId: soLineSteel.id, qty: 1 }] },
  admin,
);
check(
  '4.4 ออกใบส่งของจากใบสั่งขายที่ยังไม่ยืนยัน → 422',
  doBeforeConfirm.status === 422,
);

await req('PATCH', `/api/sales-orders/${so.id}/confirm`, null, admin);

const doSerialShort = await req(
  'POST',
  '/api/deliveries',
  { salesOrderId: so.id, lines: [{ soLineId: soLineAc.id, qty: 2, serials: [SN(1)] }] },
  admin,
);
check(
  '4.4 ใบส่งของแอร์ 2 เครื่องแต่เลือก serial ตัวเดียว → 422',
  doSerialShort.status === 422,
  doSerialShort.data?.message,
);

// ============ 4.5 Partial delivery: สั่ง 100 เส้น ส่ง 60 ก่อน ============
const do1 = (
  await req(
    'POST',
    '/api/deliveries',
    {
      salesOrderId: so.id,
      lines: [
        { soLineId: soLineSteel.id, qty: 6 }, // 6 มัด = 60 เส้น
        { soLineId: soLineAc.id, qty: 2, serials: [SN(1), SN(2)] },
      ],
    },
    admin,
  )
).data;
const balBefore = (
  await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh)
).data[0];
const confirm1 = await req('PATCH', `/api/deliveries/${do1.id}/confirm`, null, wh);
check('4.4 ยืนยันใบส่งของได้ (role WAREHOUSE)', confirm1.status === 200);

const balAfter = (
  await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh)
).data[0];
check(
  '4.4 ยืนยันแล้วสต๊อกลด 60 เส้นจริง',
  Number(balBefore.qtyOnHand) - Number(balAfter.qtyOnHand) === 60,
  `${balBefore.qtyOnHand} → ${balAfter.qtyOnHand}`,
);

const card = (
  await req(
    'GET',
    `/api/inventory/stock-card?productId=${steel.id}&warehouseId=${W}`,
    null,
    wh,
  )
).data;
check(
  '4.4 stock card มีรายการอ้างเลขใบส่งของถูกต้อง',
  card.entries.some((e) => e.refDocType === 'DO' && e.refDocId === do1.docNo),
);

const acSerial = (await req('GET', `/api/inventory/serials/${SN(1)}`, null, wh)).data;
check(
  '4.4 แอร์ที่ส่งไปเป็น SOLD + ผูกลูกค้า + เริ่มนับประกัน',
  acSerial.status === 'SOLD' &&
    acSerial.soldToPartner?.code === 'C-0002' &&
    acSerial.warranty.inWarranty === true,
);

const soAfter1 = (await req('GET', `/api/sales-orders/${so.id}`, null, admin)).data;
check(
  '4.5 ส่งบางส่วนแล้วใบสั่งขายเป็น PARTIALLY_DELIVERED',
  soAfter1.status === 'PARTIALLY_DELIVERED',
  soAfter1.status,
);

const overDeliver = await req(
  'POST',
  '/api/deliveries',
  { salesOrderId: so.id, lines: [{ soLineId: soLineSteel.id, qty: 5 }] }, // ค้าง 4 มัด
  admin,
);
check(
  '4.5 ส่งเกินยอดค้างส่ง (5 มัดจากที่ค้าง 4) → 422',
  overDeliver.status === 422,
  overDeliver.data?.message,
);

// ============ 4.6 ยกเลิกใบส่งของ = reversal ============
const do2 = (
  await req(
    'POST',
    '/api/deliveries',
    { salesOrderId: so.id, lines: [{ soLineId: soLineSteel.id, qty: 1 }] },
    admin,
  )
).data;
await req('PATCH', `/api/deliveries/${do2.id}/confirm`, null, wh);
const balAfterDo2 = Number(
  (await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh))
    .data[0].qtyOnHand,
);
const cancelDo2 = await req('PATCH', `/api/deliveries/${do2.id}/cancel`, null, admin);
check('4.6 ยกเลิกใบส่งของที่ยืนยันแล้วได้', cancelDo2.status === 200);
const balAfterCancel = Number(
  (await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh))
    .data[0].qtyOnHand,
);
check(
  '4.6 ยกเลิกแล้วสต๊อกกลับคืน 10 เส้น',
  balAfterCancel - balAfterDo2 === 10,
  `${balAfterDo2} → ${balAfterCancel}`,
);
const cardAfterCancel = (
  await req(
    'GET',
    `/api/inventory/stock-card?productId=${steel.id}&warehouseId=${W}`,
    null,
    wh,
  )
).data;
check(
  '4.6 คืนสต๊อกด้วย REVERSAL (movement เดิมยังอยู่ ไม่ถูกลบ)',
  cardAfterCancel.entries.some(
    (e) => e.movementType === 'REVERSAL' && e.refDocId === do2.docNo,
  ) &&
    cardAfterCancel.entries.some(
      (e) => e.movementType === 'ISSUE' && e.refDocId === do2.docNo,
    ),
);
const soAfterCancel = (await req('GET', `/api/sales-orders/${so.id}`, null, admin))
  .data;
const steelLineAfter = soAfterCancel.lines.find((l) => l.productId === steel.id);
check(
  '4.6 ยอดส่งสะสมบนใบสั่งขายคืนกลับเป็น 60 เส้น',
  Number(steelLineAfter.qtyDelivered) === 60,
  `qtyDelivered=${steelLineAfter.qtyDelivered}`,
);

// ============ 4.8 Invoice ============
const invNotConfirmed = await req(
  'POST',
  '/api/invoices',
  { deliveryOrderIds: [do2.id] },
  admin,
);
check('4.8 วางบิลจากใบส่งของที่ยกเลิกแล้ว → 422', invNotConfirmed.status === 422);

const inv1 = (
  await req('POST', '/api/invoices', { deliveryOrderIds: [do1.id] }, admin)
).data;
const do1Full = (await req('GET', `/api/deliveries/${do1.id}`, null, admin)).data;
const do1Sum = do1Full.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
check(
  '4.8 ยอดเงินในใบแจ้งหนี้ตรงกับใบส่งของต้นทาง (+VAT)',
  Number(inv1.subtotal) === do1Sum &&
    Number(inv1.totalAmount) === Math.round(do1Sum * 1.07 * 100) / 100,
  `subtotal=${inv1.subtotal} (DO=${do1Sum}) total=${inv1.totalAmount}`,
);
check(
  '4.8 ครบกำหนดชำระคิดจากเครดิตลูกค้า (15 วัน)',
  Math.round(
    (new Date(inv1.dueDate) - new Date(inv1.docDate)) / 86_400_000,
  ) === 15,
);
const invDup = await req(
  'POST',
  '/api/invoices',
  { deliveryOrderIds: [do1.id] },
  admin,
);
check('4.8 วางบิลใบส่งของเดิมซ้ำ → 422', invDup.status === 422);

await req('PATCH', `/api/invoices/${inv1.id}/issue`, null, admin);

// ============ 4.9 Payment ตัดหลายใบ ============
// สร้างใบแจ้งหนี้ใบที่สองจากใบส่งของใหม่
const do3 = (
  await req(
    'POST',
    '/api/deliveries',
    { salesOrderId: so.id, lines: [{ soLineId: soLineSteel.id, qty: 4 }] },
    admin,
  )
).data;
await req('PATCH', `/api/deliveries/${do3.id}/confirm`, null, wh);
const inv2 = (
  await req('POST', '/api/invoices', { deliveryOrderIds: [do3.id] }, admin)
).data;
await req('PATCH', `/api/invoices/${inv2.id}/issue`, null, admin);

const soAfterAll = (await req('GET', `/api/sales-orders/${so.id}`, null, admin)).data;
check(
  '4.5 ส่งครบทุกบรรทัดแล้ว → ใบสั่งขายเป็น DELIVERED',
  soAfterAll.status === 'DELIVERED',
  soAfterAll.status,
);

const overpay = await req(
  'POST',
  '/api/payments',
  {
    partnerId: contractor.id,
    amount: Number(inv1.totalAmount) + 1000,
    allocations: [
      { invoiceId: inv1.id, amount: Number(inv1.totalAmount) + 1000 },
    ],
  },
  admin,
);
check('4.9 จ่ายเกินยอดหนี้ → 422', overpay.status === 422, overpay.data?.message);

const mismatch = await req(
  'POST',
  '/api/payments',
  {
    partnerId: contractor.id,
    amount: 1000,
    allocations: [{ invoiceId: inv1.id, amount: 500 }],
  },
  admin,
);
check('4.9 ยอดตัดชำระไม่เท่ากับเงินที่รับ → 400', mismatch.status === 400);

// จ่ายบางส่วนก่อน
const partialPay = await req(
  'POST',
  '/api/payments',
  {
    partnerId: contractor.id,
    amount: 1000,
    method: 'CASH',
    allocations: [{ invoiceId: inv1.id, amount: 1000 }],
  },
  admin,
);
const inv1Partial = (await req('GET', `/api/invoices/${inv1.id}`, null, admin)).data;
check(
  '4.9 จ่ายบางส่วน → ใบแจ้งหนี้เป็น PARTIALLY_PAID',
  partialPay.status === 201 && inv1Partial.status === 'PARTIALLY_PAID',
  inv1Partial.status,
);

// จ่ายก้อนเดียวตัด 2 ใบให้ปิดครบ
const due1 = Number(inv1Partial.amountDue);
const due2 = Number(inv2.totalAmount);
const bigPay = await req(
  'POST',
  '/api/payments',
  {
    partnerId: contractor.id,
    amount: due1 + due2,
    method: 'TRANSFER',
    reference: 'SCB-TEST',
    allocations: [
      { invoiceId: inv1.id, amount: due1 },
      { invoiceId: inv2.id, amount: due2 },
    ],
  },
  admin,
);
check('4.9 เงินก้อนเดียวตัด 2 ใบแจ้งหนี้ได้', bigPay.status === 201);
const inv1Final = (await req('GET', `/api/invoices/${inv1.id}`, null, admin)).data;
const inv2Final = (await req('GET', `/api/invoices/${inv2.id}`, null, admin)).data;
check(
  '4.9 ทั้งสองใบเป็น PAID และยอดค้างเป็น 0',
  inv1Final.status === 'PAID' &&
    inv2Final.status === 'PAID' &&
    Number(inv1Final.amountDue) === 0 &&
    Number(inv2Final.amountDue) === 0,
  `${inv1Final.status}/${inv2Final.status}`,
);

const outstanding = (
  await req('GET', '/api/invoices/outstanding', null, admin)
).data;
check(
  '4.9 ลูกหนี้ค้างชำระไม่มีใบที่ปิดยอดแล้ว',
  !outstanding.some((o) => o.id === inv1.id || o.id === inv2.id),
);

// ============ 4.10 e2e ครบสาย ============
check(
  '4.10 เดินเอกสารครบสาย QT → SO → DO(2 ใบ) → INV(2 ใบ) → Payment สำเร็จ',
  qtFull.status === 'CONVERTED' &&
    soAfterAll.status === 'DELIVERED' &&
    inv1Final.status === 'PAID' &&
    inv2Final.status === 'PAID',
);

const rec = (await req('GET', '/api/inventory/reconcile', null, admin)).data;
check('4.10 reconcile clean หลังเดินเอกสารครบสาย', rec.clean === true, JSON.stringify(rec.mismatches));

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
