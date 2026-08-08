// ทดสอบเกณฑ์ ✔ ของเฟส 5 (Purchase Flow: PO → GR) ตาม STEPS.md
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
const uomBag = uoms.find((u) => u.code === 'BAG').id;

const partners = (await req('GET', '/api/partners', null, admin)).data.data;
const supplier = partners.find((p) => p.code === 'S-0001');
const contractor = partners.find((p) => p.code === 'C-0002');

// สินค้าทดสอบ: เหล็ก (FIFO, หลายหน่วย) + ปูน (LOT + FIFO)
const steel = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `P5-STL-${stamp}`,
      name: 'เหล็กเส้นทดสอบเฟส 5',
      baseUomId: uomBar,
      costingMethod: 'FIFO',
      priceRetail: 58,
      priceContractor: 54,
      units: [{ uomId: uomBundle, conversionFactor: 10 }],
    },
    admin,
  )
).data;
const cement = (
  await req(
    'POST',
    '/api/products',
    {
      sku: `P5-CEM-${stamp}`,
      name: 'ปูนทดสอบเฟส 5',
      baseUomId: uomBag,
      trackingType: 'LOT',
      costingMethod: 'FIFO',
      priceRetail: 135,
      priceContractor: 125,
    },
    admin,
  )
).data;

// ============ 5.1 Purchase Order ============
const poWrongPartner = await req(
  'POST',
  '/api/purchase-orders',
  {
    partnerId: contractor.id, // ลูกค้า ไม่ใช่ซัพพลายเออร์
    warehouseId: W,
    lines: [{ productId: steel.id, qty: 10, unitCost: 45 }],
  },
  admin,
);
check(
  '5.1 สั่งซื้อจากคู่ค้าที่ไม่ใช่ซัพพลายเออร์ → 422',
  poWrongPartner.status === 422,
  poWrongPartner.data?.message,
);

const po = (
  await req(
    'POST',
    '/api/purchase-orders',
    {
      partnerId: supplier.id,
      warehouseId: W,
      lines: [
        { productId: steel.id, productUnitId: steel.units[0].id, qty: 10, unitCost: 440 }, // 10 มัด = 100 เส้น
        { productId: cement.id, qty: 100, unitCost: 110 },
      ],
    },
    admin,
  )
).data;
check(
  '5.1 สร้างใบสั่งซื้อได้ เลขที่ถูกรูปแบบ + เป็นฉบับร่าง',
  /^PO-\d{4}-\d{2}-\d{4}$/.test(po.docNo) && po.status === 'DRAFT',
  po.docNo,
);
check(
  '5.1 แปลงหน่วยซื้อเป็นหน่วยฐาน (10 มัด = 100 เส้น) + ยอดเงินถูก',
  Number(po.lines[0].baseQty) === 100 &&
    Number(po.subtotal) === 15400 && // 10×440 + 100×110
    Number(po.totalAmount) === 16478, // +VAT 7%
  `base=${po.lines[0].baseQty} subtotal=${po.subtotal} total=${po.totalAmount}`,
);

const grBeforeApprove = await req(
  'POST',
  '/api/goods-receipts',
  { purchaseOrderId: po.id, lines: [{ poLineId: po.lines[0].id, qty: 1 }] },
  wh,
);
check(
  '5.1 รับของจากใบสั่งซื้อที่ยังไม่อนุมัติ → 422',
  grBeforeApprove.status === 422,
);

const approveByWh = await req(
  'PATCH',
  `/api/purchase-orders/${po.id}/approve`,
  null,
  wh,
);
check(
  '5.1 พนักงานคลังอนุมัติใบสั่งซื้อเอง → 403 (ผูกพันเงิน ต้องผู้จัดการ)',
  approveByWh.status === 403,
);
await req('PATCH', `/api/purchase-orders/${po.id}/approve`, null, admin);

// ============ 5.2 Goods Receipt + cost layer ============
const poLineSteel = po.lines.find((l) => l.productId === steel.id);
const poLineCement = po.lines.find((l) => l.productId === cement.id);

const grNoLot = await req(
  'POST',
  '/api/goods-receipts',
  {
    purchaseOrderId: po.id,
    lines: [{ poLineId: poLineCement.id, qty: 50 }],
  },
  wh,
);
check(
  '5.2 รับปูนโดยไม่ระบุล็อต → 400',
  grNoLot.status === 400,
  grNoLot.data?.message,
);

// ============ 5.3 รับบางส่วน: สั่ง 10 มัด รับ 6 มัดก่อน ============
const gr1 = (
  await req(
    'POST',
    '/api/goods-receipts',
    {
      purchaseOrderId: po.id,
      supplierRef: `SUP-INV-${stamp}`,
      lines: [
        { poLineId: poLineSteel.id, qty: 6 }, // 6 มัด = 60 เส้น
        {
          poLineId: poLineCement.id,
          qty: 50,
          lotNo: `LOT-P5-${stamp}`,
          expiryDate: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        },
      ],
    },
    wh,
  )
).data;
check('5.3 สร้างใบรับของแบบรับบางส่วนได้', gr1.docNo?.startsWith('GR-'));

const confirm1 = await req('PATCH', `/api/goods-receipts/${gr1.id}/confirm`, null, wh);
check('5.2 ยืนยันใบรับของได้ (role WAREHOUSE)', confirm1.status === 200);

const balSteel = (
  await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh)
).data[0];
check(
  '5.2 ยืนยันแล้วสต๊อกเข้า 60 เส้น ทุนเฉลี่ย 44 (440÷10)',
  Number(balSteel.qtyOnHand) === 60 && Number(balSteel.avgCost) === 44,
  `qty=${balSteel.qtyOnHand} avg=${balSteel.avgCost}`,
);

const layers = (
  await req('GET', `/api/inventory/cost-layers?productId=${steel.id}`, null, admin)
).data;
check(
  '5.2 สร้าง cost layer FIFO จากการรับเข้า (60 เส้น @44)',
  layers.length === 1 &&
    Number(layers[0].remainingQty) === 60 &&
    Number(layers[0].unitCost) === 44,
  layers.map((l) => `${l.remainingQty}@${Number(l.unitCost)}`).join(),
);

const cardGr = (
  await req(
    'GET',
    `/api/inventory/stock-card?productId=${steel.id}&warehouseId=${W}`,
    null,
    wh,
  )
).data;
check(
  '5.2 stock card อ้างเลขใบรับของถูกต้อง',
  cardGr.entries.some((e) => e.refDocType === 'GR' && e.refDocId === gr1.docNo),
);

const cemLots = (
  await req('GET', `/api/inventory/lots?productId=${cement.id}`, null, wh)
).data;
check(
  '5.2 ปูนเข้าล็อตพร้อมวันหมดอายุ (50 ถุง)',
  cemLots.length === 1 && Number(cemLots[0].remainingQty) === 50,
);

const poAfter1 = (await req('GET', `/api/purchase-orders/${po.id}`, null, admin)).data;
check(
  '5.3 รับบางส่วนแล้วใบสั่งซื้อเป็น PARTIALLY_RECEIVED',
  poAfter1.status === 'PARTIALLY_RECEIVED',
  poAfter1.status,
);
check(
  '5.3 ยอดรับสะสมบนบรรทัดถูกต้อง (60 จาก 100)',
  Number(poAfter1.lines.find((l) => l.productId === steel.id).qtyReceived) === 60,
);

const overReceive = await req(
  'POST',
  '/api/goods-receipts',
  { purchaseOrderId: po.id, lines: [{ poLineId: poLineSteel.id, qty: 5 }] },
  wh,
);
check(
  '5.3 รับเกินยอดค้างรับ (5 มัดจากที่ค้าง 4) → 422',
  overReceive.status === 422,
  overReceive.data?.message,
);

// ============ 5.3 ยกเลิกใบรับของ = reversal ============
const gr2 = (
  await req(
    'POST',
    '/api/goods-receipts',
    { purchaseOrderId: po.id, lines: [{ poLineId: poLineSteel.id, qty: 1 }] },
    wh,
  )
).data;
await req('PATCH', `/api/goods-receipts/${gr2.id}/confirm`, null, wh);
const balAfterGr2 = Number(
  (await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh))
    .data[0].qtyOnHand,
);
const cancelGr2 = await req(
  'PATCH',
  `/api/goods-receipts/${gr2.id}/cancel`,
  null,
  admin,
);
check('5.3 ยกเลิกใบรับของที่ยืนยันแล้วได้', cancelGr2.status === 200);
const balAfterCancel = Number(
  (await req('GET', `/api/inventory/balances?productId=${steel.id}`, null, wh))
    .data[0].qtyOnHand,
);
check(
  '5.3 ยกเลิกแล้วสต๊อกลดกลับ 10 เส้น',
  balAfterGr2 - balAfterCancel === 10,
  `${balAfterGr2} → ${balAfterCancel}`,
);
const poAfterCancel = (await req('GET', `/api/purchase-orders/${po.id}`, null, admin))
  .data;
check(
  '5.3 ยอดรับสะสมคืนกลับเป็น 60',
  Number(poAfterCancel.lines.find((l) => l.productId === steel.id).qtyReceived) === 60,
);

// รับส่วนที่เหลือให้ครบ
await req(
  'POST',
  '/api/goods-receipts',
  { purchaseOrderId: po.id, lines: [{ poLineId: poLineSteel.id, qty: 4, unitCost: 480 }] },
  wh,
).then((r) => req('PATCH', `/api/goods-receipts/${r.data.id}/confirm`, null, wh));
await req(
  'POST',
  '/api/goods-receipts',
  {
    purchaseOrderId: po.id,
    lines: [
      {
        poLineId: poLineCement.id,
        qty: 50,
        lotNo: `LOT-P5B-${stamp}`,
        expiryDate: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      },
    ],
  },
  wh,
).then((r) => req('PATCH', `/api/goods-receipts/${r.data.id}/confirm`, null, wh));

const poFinal = (await req('GET', `/api/purchase-orders/${po.id}`, null, admin)).data;
check(
  '5.3 รับครบทุกบรรทัด → ใบสั่งซื้อเป็น RECEIVED',
  poFinal.status === 'RECEIVED',
  poFinal.status,
);

const layersFinal = (
  await req('GET', `/api/inventory/cost-layers?productId=${steel.id}`, null, admin)
).data;
// layer ของใบรับที่ถูกยกเลิกยังอยู่แต่เหลือ 0 (append-only) — ดูเฉพาะที่ยังมีของ
const activeLayers = layersFinal.filter((l) => Number(l.remainingQty) > 0);
check(
  '5.2 ทุนจริงที่รับต่างจากใบสั่งซื้อได้ (ล็อตหลัง @48 ไม่ใช่ @44)',
  activeLayers.length === 2 &&
    Number(activeLayers[0].unitCost) === 44 &&
    Number(activeLayers[1].unitCost) === 48,
  layersFinal.map((l) => `${l.remainingQty}@${Number(l.unitCost)}`).join(' | '),
);
check(
  '5.3 layer ของใบรับที่ยกเลิกยังอยู่ในระบบแต่เหลือ 0 (append-only)',
  layersFinal.length === 3 &&
    layersFinal.some((l) => Number(l.remainingQty) === 0),
);

// ============ 5.4 e2e ซื้อ → ขาย + กำไรขั้นต้น ============
// ขายเหล็ก 70 เส้นให้ช่างสมชาย (ราคาช่าง 54) → FIFO กิน 60@44 + 10@48
const so = (
  await req(
    'POST',
    '/api/sales-orders',
    {
      partnerId: contractor.id,
      warehouseId: W,
      lines: [{ productId: steel.id, qty: 70 }],
    },
    admin,
  )
).data;
await req('PATCH', `/api/sales-orders/${so.id}/confirm`, null, admin);
const doc = (
  await req(
    'POST',
    '/api/deliveries',
    { salesOrderId: so.id, lines: [{ soLineId: so.lines[0].id, qty: 70 }] },
    admin,
  )
).data;
await req('PATCH', `/api/deliveries/${doc.id}/confirm`, null, wh);
const inv = (
  await req('POST', '/api/invoices', { deliveryOrderIds: [doc.id] }, admin)
).data;
await req('PATCH', `/api/invoices/${inv.id}/issue`, null, admin);

const cardSale = (
  await req(
    'GET',
    `/api/inventory/stock-card?productId=${steel.id}&warehouseId=${W}`,
    null,
    wh,
  )
).data;
const issueEntry = cardSale.entries.find(
  (e) => e.movementType === 'ISSUE' && e.refDocId === doc.docNo,
);
// FIFO: 60×44 + 10×48 = 2,640 + 480 = 3,120
check(
  '5.4 ขาย 70 เส้น → ต้นทุน FIFO = 3,120 (60@44 + 10@48)',
  Math.abs(Number(issueEntry.totalCost)) === 3120,
  `totalCost=${issueEntry.totalCost}`,
);

const profit = (
  await req(`GET`, `/api/reports/gross-profit?partnerId=${contractor.id}`, null, admin)
).data;
const steelRow = profit.byProduct.find((p) => p.sku === steel.sku);
// รายได้ 70×54 = 3,780 − ต้นทุน 3,120 = กำไร 660
check(
  '5.4 รายงานกำไรขั้นต้น: รายได้ 3,780 − ทุน 3,120 = กำไร 660',
  Number(steelRow.revenue) === 3780 &&
    Number(steelRow.cost) === 3120 &&
    Number(steelRow.profit) === 660,
  `รายได้ ${steelRow?.revenue} ทุน ${steelRow?.cost} กำไร ${steelRow?.profit}`,
);
check(
  '5.4 อัตรากำไรคำนวณถูก (660/3780 ≈ 17.46%)',
  Math.abs(
    Number(
      profit.detail.find((d) => d.sku === steel.sku).marginPercent,
    ) - 17.46,
  ) < 0.01,
  `${profit.detail.find((d) => d.sku === steel.sku)?.marginPercent}%`,
);

const profitByWh = await req('GET', '/api/reports/gross-profit', null, wh);
check('5.4 พนักงานคลังดูรายงานกำไร → 403', profitByWh.status === 403);

const rec = (await req('GET', '/api/inventory/reconcile', null, admin)).data;
check('5.4 reconcile clean หลังซื้อ-ขายครบวงจร', rec.clean === true, JSON.stringify(rec.mismatches));

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
