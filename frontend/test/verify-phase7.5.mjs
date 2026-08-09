// ทดสอบเกณฑ์ ✔ ของเฟส 7.5 (รับของ/จ่ายของแบบยิงบาร์โค้ด)
// จำลองสิ่งที่หน้าเว็บทำหลังยิงเสร็จ แล้วตรวจว่า ledger/เอกสารถูกต้องจริง
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3001';
if (BASE.startsWith('https')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const results = [];
const check = (name, cond, detail = '') =>
  results.push({ name, pass: !!cond, detail });

class Session {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value === '' || /Max-Age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  async fetch(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.headers ?? {}),
        ...(this.cookies.size ? { cookie: this.header() } : {}),
      },
    });
    this.absorb(res);
    return res;
  }
  async json(path, init) {
    const res = await this.fetch(path, init);
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }
  post(path, body) {
    return this.json(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  patch(path, body) {
    return this.json(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

async function loginAs(email) {
  const s = new Session();
  await s.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Admin@1234' }),
  });
  return s;
}
/** จำลองการยิงบาร์โค้ด: หน้าเว็บจะได้สินค้า + หน่วย + ยอดคงเหลือกลับมา */
const scan = (s, code) =>
  s.json(`/api/proxy/products/by-barcode/${encodeURIComponent(code)}`);

const admin = await loginAs('admin@store.local');
const wh = await loginAs('warehouse@store.local');
const stamp = Date.now();

const W = (await admin.json('/api/proxy/warehouses')).data.find(
  (w) => w.code === 'WH-MAIN',
).id;
const uoms = (await admin.json('/api/proxy/uoms')).data;
const uomBar = uoms.find((u) => u.code === 'BAR').id;
const uomBundle = uoms.find((u) => u.code === 'BUNDLE').id;
const uomEA = uoms.find((u) => u.code === 'EA').id;
const uomBag = uoms.find((u) => u.code === 'BAG').id;
const partners = (await admin.json('/api/proxy/partners')).data.data;
const supplier = partners.find((p) => p.code === 'S-0001');
const customer = partners.find((p) => p.code === 'C-0002');

// ============ หน้าเปิดได้ ============
// ตรวจข้อความที่มีเฉพาะในหน้านั้นจริง ๆ (ไม่ใช่ชื่อเมนูที่อยู่ในทุกหน้า)
for (const [path, title, quickOption] of [
  ['/receive', 'รับของเข้าคลัง', 'รับเข้าเลย ไม่มีใบสั่งซื้อ'],
  ['/issue', 'จ่ายของออกจากคลัง', 'จ่ายออกเลย ไม่มีใบสั่งขาย'],
]) {
  const res = await wh.fetch(path);
  const html = await res.text();
  check(
    `7.5 หน้า ${title} เปิดได้ (ฝ่ายคลัง)`,
    res.status === 200 && html.includes(title),
  );
  check(
    `7.5 ${title}: โครงหน้าขึ้นทันทีไม่ต้องรอโหลด + มีตัวเลือกทำงานแบบไม่มีเอกสาร`,
    html.includes(quickOption) && html.includes('เริ่มสแกน'),
  );
}

// ============ เตรียมสินค้า 3 แบบ ============
const steel = (
  await admin.post('/api/proxy/products', {
    sku: `S75-STL-${stamp}`,
    name: 'เหล็กเส้นทดสอบรับจ่าย',
    baseUomId: uomBar,
    priceRetail: 58,
    units: [{ uomId: uomBundle, conversionFactor: 10, salePrice: 520 }],
  })
).data;
await admin.post(`/api/proxy/products/${steel.id}/barcodes`, {});
await admin.post(`/api/proxy/products/${steel.id}/barcodes`, {
  productUnitId: steel.units[0].id,
});

const ac = (
  await admin.post('/api/proxy/products', {
    sku: `S75-AC-${stamp}`,
    name: 'แอร์ทดสอบรับจ่าย',
    baseUomId: uomEA,
    trackingType: 'SERIAL',
    warrantyMonths: 12,
    priceRetail: 14900,
  })
).data;
await admin.post(`/api/proxy/products/${ac.id}/barcodes`, {});

const cement = (
  await admin.post('/api/proxy/products', {
    sku: `S75-CEM-${stamp}`,
    name: 'ปูนทดสอบรับจ่าย',
    baseUomId: uomBag,
    trackingType: 'LOT',
    costingMethod: 'FIFO',
    priceRetail: 135,
  })
).data;
await admin.post(`/api/proxy/products/${cement.id}/barcodes`, {});

// ============ รับเข้าแบบไม่มีใบสั่งซื้อ ============
// ยิง QR หน่วย "มัด" → ระบบต้องรู้ว่า 1 มัด = 10 เส้น
const scanBundle = await scan(wh, `INT:${steel.sku}:BUNDLE`);
check(
  '7.5 ยิงบาร์โค้ดหน่วยมัด → รู้ตัวคูณ 10 (หน้าเว็บใช้แปลงก่อนบันทึก)',
  Number(scanBundle.data.scannedUnit.conversionFactor) === 10,
);

const refIn = `RCV-TEST-${stamp}`;
// หน้าเว็บกรอก 5 มัด ทุนมัดละ 450 → ส่งเป็นหน่วยฐาน 50 เส้น ทุนเส้นละ 45
const recvSteel = await wh.post('/api/proxy/inventory/receipts', {
  productId: steel.id,
  warehouseId: W,
  qty: 5 * 10,
  unitCost: 450 / 10,
  refDocType: 'MANUAL',
  refDocId: refIn,
  note: 'รับเข้าจากหน้าสแกน',
});
check('7.5 รับเข้าแบบไม่มีใบสั่งซื้อสำเร็จ', recvSteel.status === 201);

const balSteel = (
  await wh.json(`/api/proxy/inventory/balances?productId=${steel.id}`)
).data.data[0];
check(
  '7.5 ยิง 5 มัด → เข้าสต๊อก 50 เส้น ทุนเส้นละ 45 (แปลงหน่วยถูก)',
  Number(balSteel.qtyOnHand) === 50 && Number(balSteel.avgCost) === 45,
  `${balSteel.qtyOnHand} เส้น @ ${balSteel.avgCost}`,
);

// รับแอร์ต้องยิง serial ครบทุกเครื่อง
const SN = (n) => `S75SN-${stamp}-${n}`;
const acNoSerial = await wh.post('/api/proxy/inventory/receipts', {
  productId: ac.id,
  warehouseId: W,
  qty: 2,
  unitCost: 12000,
  refDocType: 'MANUAL',
  refDocId: refIn,
});
check(
  '7.5 รับแอร์โดยไม่ยิง serial → ระบบไม่ยอม (หน้าเว็บก็กันไว้ก่อนแล้ว)',
  acNoSerial.status === 422,
);
const acOk = await wh.post('/api/proxy/inventory/receipts', {
  productId: ac.id,
  warehouseId: W,
  qty: 2,
  unitCost: 12000,
  refDocType: 'MANUAL',
  refDocId: refIn,
  serials: [SN(1), SN(2)],
});
check('7.5 รับแอร์พร้อมยิง serial 2 เครื่อง → สำเร็จ', acOk.status === 201);

// รับปูนต้องมีเลขล็อต + วันหมดอายุ
const day = 86_400_000;
const cemOk = await wh.post('/api/proxy/inventory/receipts', {
  productId: cement.id,
  warehouseId: W,
  qty: 100,
  unitCost: 110,
  refDocType: 'MANUAL',
  refDocId: refIn,
  lotNo: `L75-${stamp}`,
  expiryDate: new Date(Date.now() + 45 * day).toISOString(),
});
check('7.5 รับปูนพร้อมเลขล็อต+วันหมดอายุ → สำเร็จ', cemOk.status === 201);

// ============ จ่ายออกแบบไม่มีใบสั่งขาย ============
// หน้าเว็บกันไม่ให้จ่ายเกินยอดคงเหลือ — ตรวจว่า backend กันด้วย
const overIssue = await wh.post('/api/proxy/inventory/issues', {
  productId: steel.id,
  warehouseId: W,
  qty: 60,
  refDocType: 'MANUAL',
  refDocId: `ISS-TEST-${stamp}`,
});
check(
  '7.5 จ่ายเกินยอดคงเหลือ → ถูกปฏิเสธ (กันสองชั้น หน้าเว็บ + backend)',
  overIssue.status === 422,
);

const issueSteel = await wh.post('/api/proxy/inventory/issues', {
  productId: steel.id,
  warehouseId: W,
  qty: 2 * 10,
  refDocType: 'MANUAL',
  refDocId: `ISS-TEST-${stamp}`,
  note: 'จ่ายออกจากหน้าสแกน',
});
check('7.5 จ่ายออก 2 มัด (20 เส้น) สำเร็จ', issueSteel.status === 201);

const balAfter = (
  await wh.json(`/api/proxy/inventory/balances?productId=${steel.id}`)
).data.data[0];
check(
  '7.5 ยอดคงเหลือลดถูกต้อง (50 − 20 = 30 เส้น)',
  Number(balAfter.qtyOnHand) === 30,
  `${balAfter.qtyOnHand}`,
);

// จ่ายปูนต้องเลือกล็อต — หน้าเว็บดึงรายการแบบ FEFO มาให้เลือก
const lots = (
  await wh.json(
    `/api/proxy/inventory/lots?productId=${cement.id}&warehouseId=${W}`,
  )
).data;
check(
  '7.5 หน้าจ่ายของดึงรายการล็อตมาให้เลือกได้ (พร้อมยอดคงเหลือรายล็อต)',
  lots.length === 1 && Number(lots[0].remainingQty) === 100,
);
const cemNoLot = await wh.post('/api/proxy/inventory/issues', {
  productId: cement.id,
  warehouseId: W,
  qty: 10,
  refDocType: 'MANUAL',
  refDocId: `ISS-TEST-${stamp}`,
});
check('7.5 จ่ายปูนโดยไม่เลือกล็อต → ถูกปฏิเสธ', cemNoLot.status === 400);
const cemIssue = await wh.post('/api/proxy/inventory/issues', {
  productId: cement.id,
  warehouseId: W,
  qty: 10,
  lotId: lots[0].id,
  refDocType: 'MANUAL',
  refDocId: `ISS-TEST-${stamp}`,
});
check('7.5 จ่ายปูนพร้อมเลือกล็อต → สำเร็จ', cemIssue.status === 201);

// จ่ายแอร์ต้องยิง serial ที่มีอยู่จริงและยังอยู่ในคลัง
const acIssueBad = await wh.post('/api/proxy/inventory/issues', {
  productId: ac.id,
  warehouseId: W,
  qty: 1,
  serials: ['ไม่มีจริง'],
  refDocType: 'MANUAL',
  refDocId: `ISS-TEST-${stamp}`,
});
check('7.5 จ่ายแอร์ด้วย serial ที่ไม่มีจริง → ถูกปฏิเสธ', acIssueBad.status === 422);

const acIssue = await wh.post('/api/proxy/inventory/issues', {
  productId: ac.id,
  warehouseId: W,
  qty: 1,
  serials: [SN(1)],
  soldToPartnerId: customer.id,
  refDocType: 'MANUAL',
  refDocId: `ISS-TEST-${stamp}`,
});
check('7.5 จ่ายแอร์พร้อมยิง serial → สำเร็จ', acIssue.status === 201);
const serialAfter = (
  await wh.json(`/api/proxy/inventory/serials/${SN(1)}`)
).data;
check(
  '7.5 เครื่องที่จ่ายออกเปลี่ยนเป็นขายแล้ว + เริ่มนับประกัน',
  serialAfter.status === 'SOLD' && serialAfter.warranty.inWarranty === true,
);
const serialLeft = (
  await wh.json(`/api/proxy/inventory/serials/${SN(2)}`)
).data;
check(
  '7.5 เครื่องที่ยังไม่จ่ายยังอยู่ในคลัง',
  serialLeft.status === 'IN_STOCK',
);

// ============ รับของตามใบสั่งซื้อ (GR) ============
const po = (
  await admin.post('/api/proxy/purchase-orders', {
    partnerId: supplier.id,
    warehouseId: W,
    lines: [
      { productId: steel.id, productUnitId: steel.units[0].id, qty: 10, unitCost: 460 },
    ],
  })
).data;
await admin.patch(`/api/proxy/purchase-orders/${po.id}/approve`);

const poFull = (await wh.json(`/api/proxy/purchase-orders/${po.id}`)).data;
const poLine = poFull.lines[0];
const remaining =
  (Number(poLine.baseQty) - Number(poLine.qtyReceived)) /
  Number(poLine.productUnit.conversionFactor);
check(
  '7.5 เปิดใบสั่งซื้อแล้วรู้ยอดค้างรับของแต่ละบรรทัด (10 มัด)',
  remaining === 10,
  `ค้างรับ ${remaining}`,
);

// รับ 6 มัดก่อน (ส่งมาไม่ครบ)
const gr = await wh.post('/api/proxy/goods-receipts', {
  purchaseOrderId: po.id,
  lines: [{ poLineId: poLine.id, qty: 6, unitCost: 460 }],
});
check('7.5 สร้างใบรับของจากรายการที่ยิงได้', gr.status === 201);
const grConfirm = await wh.patch(`/api/proxy/goods-receipts/${gr.data.id}/confirm`);
check('7.5 ยืนยันใบรับของ → ของเข้าสต๊อกจริง', grConfirm.status === 200);

const balAfterGr = (
  await wh.json(`/api/proxy/inventory/balances?productId=${steel.id}`)
).data.data[0];
check(
  '7.5 รับ 6 มัดตามใบสั่งซื้อ → สต๊อกเพิ่ม 60 เส้น (30 → 90)',
  Number(balAfterGr.qtyOnHand) === 90,
  `${balAfterGr.qtyOnHand}`,
);

const poAfter = (await wh.json(`/api/proxy/purchase-orders/${po.id}`)).data;
check(
  '7.5 ใบสั่งซื้อเป็น "รับบางส่วน" และยอดค้างรับเหลือ 4 มัด',
  poAfter.status === 'PARTIALLY_RECEIVED' &&
    (Number(poAfter.lines[0].baseQty) - Number(poAfter.lines[0].qtyReceived)) /
      10 ===
      4,
  poAfter.status,
);

const overGr = await wh.post('/api/proxy/goods-receipts', {
  purchaseOrderId: po.id,
  lines: [{ poLineId: poLine.id, qty: 5 }],
});
check(
  '7.5 รับเกินยอดค้างรับ (5 จาก 4 มัด) → ถูกปฏิเสธพร้อมบอกยอดที่รับได้',
  overGr.status === 422 && /รับได้อีกแค่/.test(overGr.data?.message ?? ''),
  overGr.data?.message,
);

// ============ ส่งของตามใบสั่งขาย (DO) ============
const so = (
  await admin.post('/api/proxy/sales-orders', {
    partnerId: customer.id,
    warehouseId: W,
    lines: [{ productId: steel.id, qty: 40 }],
  })
).data;
await admin.patch(`/api/proxy/sales-orders/${so.id}/confirm`);

const soFull = (await wh.json(`/api/proxy/sales-orders/${so.id}`)).data;
const doc = await wh.post('/api/proxy/deliveries', {
  salesOrderId: so.id,
  lines: [{ soLineId: soFull.lines[0].id, qty: 25 }],
});
check('7.5 สร้างใบส่งของจากรายการที่ยิงได้', doc.status === 201);
const docConfirm = await wh.patch(`/api/proxy/deliveries/${doc.data.id}/confirm`);
check('7.5 ยืนยันใบส่งของ → ตัดสต๊อกจริง', docConfirm.status === 200);

const balAfterDo = (
  await wh.json(`/api/proxy/inventory/balances?productId=${steel.id}`)
).data.data[0];
check(
  '7.5 ส่ง 25 เส้น → สต๊อกลดเหลือ 65',
  Number(balAfterDo.qtyOnHand) === 65,
  `${balAfterDo.qtyOnHand}`,
);

const soAfter = (await wh.json(`/api/proxy/sales-orders/${so.id}`)).data;
check(
  '7.5 ใบสั่งขายเป็น "ส่งบางส่วน" ค้างส่งอีก 15 เส้น',
  soAfter.status === 'PARTIALLY_DELIVERED' &&
    Number(soAfter.lines[0].baseQty) - Number(soAfter.lines[0].qtyDelivered) ===
      15,
);

const overDo = await wh.post('/api/proxy/deliveries', {
  salesOrderId: so.id,
  lines: [{ soLineId: soFull.lines[0].id, qty: 20 }],
});
check(
  '7.5 ส่งเกินยอดค้างส่ง → ถูกปฏิเสธพร้อมบอกยอดที่ส่งได้',
  overDo.status === 422 && /ส่งได้อีกแค่/.test(overDo.data?.message ?? ''),
  overDo.data?.message,
);

// ============ ตรวจรอย: ทุกอย่างที่ยิงต้องตามรอยได้ ============
const card = (
  await wh.json(
    `/api/proxy/inventory/stock-card?productId=${steel.id}&warehouseId=${W}`,
  )
).data;
check(
  '7.5 stock card เห็นครบทุกรายการที่ยิง (รับเร็ว/จ่ายเร็ว/ใบรับของ/ใบส่งของ)',
  ['MANUAL', 'GR', 'DO'].every((t) =>
    card.entries.some((e) => e.refDocType === t),
  ),
  card.entries.map((e) => e.refDocType).join(', '),
);

const rec = (await admin.json('/api/proxy/inventory/reconcile')).data;
check('7.5 reconcile สะอาดหลังรับ-จ่ายจากหน้าสแกน', rec.clean === true);

// ============ สิทธิ์ ============
const salesUser = await loginAs('sales@store.local');
const salesIssue = await salesUser.post('/api/proxy/inventory/issues', {
  productId: steel.id,
  warehouseId: W,
  qty: 1,
  refDocType: 'MANUAL',
  refDocId: `HACK-${stamp}`,
});
check('7.5 ฝ่ายขายจ่ายของออกเองไม่ได้ (เป็นงานของฝ่ายคลัง)', salesIssue.status === 403);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
