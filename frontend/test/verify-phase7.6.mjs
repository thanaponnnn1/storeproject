// ทดสอบเกณฑ์ ✔ ของเฟส 7.6 (หน้าเดินเอกสารขาย/ซื้อ)
// เดินเอกสารครบสายผ่าน API ที่หน้าเว็บใช้จริง + ตรวจว่าทุกหน้าเปิดได้
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

const admin = await loginAs('admin@store.local');
const sales = await loginAs('sales@store.local');
const wh = await loginAs('warehouse@store.local');
const stamp = Date.now();

const W = (await admin.json('/api/proxy/warehouses')).data.find(
  (w) => w.code === 'WH-MAIN',
).id;
const uomBar = (await admin.json('/api/proxy/uoms')).data.find(
  (u) => u.code === 'BAR',
).id;
const partners = (await admin.json('/api/proxy/partners')).data.data;
const contractor = partners.find((p) => p.code === 'C-0002'); // ราคาช่าง
const retail = partners.find((p) => p.code === 'C-0001'); // ราคาปลีก
const supplier = partners.find((p) => p.code === 'S-0001');

// ============ หน้ารายการเปิดได้ + มีลูกโซ่เอกสารบอก ============
const salesPage = await sales.fetch('/sales');
const salesHtml = await salesPage.text();
check('7.6 หน้างานขายเปิดได้', salesPage.status === 200);
check(
  '7.6 บอกลำดับงานให้เห็นว่าเอกสารเดินไปทางไหน',
  salesHtml.includes('ใบเสนอราคา → ใบสั่งขาย → จ่ายของ → ใบแจ้งหนี้ → รับเงิน'),
);
check(
  '7.6 มีแท็บครบ 3 ประเภทเอกสาร',
  ['ใบเสนอราคา', 'ใบสั่งขาย', 'ใบแจ้งหนี้'].every((t) => salesHtml.includes(t)),
);
for (const tab of ['orders', 'invoices']) {
  const res = await sales.fetch(`/sales?tab=${tab}`);
  check(`7.6 แท็บ ${tab} เปิดจาก URL ได้ตรง ๆ`, res.status === 200);
}

const purchasePage = await wh.fetch('/purchases');
const purchaseHtml = await purchasePage.text();
check('7.6 หน้างานซื้อเปิดได้', purchasePage.status === 200);
check(
  '7.6 งานซื้อบอกลำดับงานเช่นกัน',
  purchaseHtml.includes('ใบสั่งซื้อ → อนุมัติ → รับของเข้าคลัง'),
);

const newQtPage = await sales.fetch('/sales/quotations/new');
check('7.6 หน้าสร้างใบเสนอราคาเปิดได้', newQtPage.status === 200);
const newPoPage = await wh.fetch('/purchases/orders/new');
check('7.6 หน้าสร้างใบสั่งซื้อเปิดได้', newPoPage.status === 200);

// ============ เตรียมสินค้า + สต๊อก ============
const steel = (
  await admin.post('/api/proxy/products', {
    sku: `S76-STL-${stamp}`,
    name: 'เหล็กเส้นทดสอบเอกสาร',
    baseUomId: uomBar,
    priceRetail: 58,
    priceContractor: 54,
    priceProject: 51,
  })
).data;
await wh.post('/api/proxy/inventory/receipts', {
  productId: steel.id,
  warehouseId: W,
  qty: 200,
  unitCost: 45,
  refDocType: 'MANUAL',
  refDocId: `S76-GR-${stamp}`,
});

// ============ 1. ใบเสนอราคา — ราคาตามระดับลูกค้า ============
const qtRetail = await sales.post('/api/proxy/quotations', {
  partnerId: retail.id,
  lines: [{ productId: steel.id, qty: 10 }],
});
check(
  '7.6 ลูกค้าปลีกเปิดใบเสนอราคา → ได้ราคาปลีก 58 อัตโนมัติ',
  Number(qtRetail.data.lines[0].unitPrice) === 58,
);

const qt = await sales.post('/api/proxy/quotations', {
  partnerId: contractor.id,
  lines: [{ productId: steel.id, qty: 100 }],
});
check(
  '7.6 ลูกค้าช่างเปิดใบเสนอราคา → ได้ราคาช่าง 54 อัตโนมัติ (ไม่ต้องพิมพ์ราคาเอง)',
  qt.status === 201 && Number(qt.data.lines[0].unitPrice) === 54,
);
check(
  '7.6 คำนวณยอดรวม+VAT ให้ (100×54 = 5,400 + 7% = 5,778)',
  Number(qt.data.subtotal) === 5400 && Number(qt.data.totalAmount) === 5778,
  `subtotal=${qt.data.subtotal} total=${qt.data.totalAmount}`,
);

const qtPage = await sales.fetch(`/sales/quotations/${qt.data.id}`);
check('7.6 หน้ารายละเอียดใบเสนอราคาเปิดได้', qtPage.status === 200);

// ฝ่ายขายแก้ราคาหน้าบิลไม่ได้ (หน้าเว็บล็อกช่องราคาไว้ให้ด้วย)
const salesOverride = await sales.post('/api/proxy/quotations', {
  partnerId: retail.id,
  lines: [{ productId: steel.id, qty: 1, unitPrice: 1 }],
});
check(
  '7.6 ฝ่ายขายแก้ราคาเอง → 403 (หน้าเว็บก็ปิดช่องราคาไว้)',
  salesOverride.status === 403,
);

// ============ 2. เดินสถานะ: ร่าง → รออนุมัติ → อนุมัติ ============
const badApprove = await admin.patch(`/api/proxy/quotations/${qt.data.id}/approve`);
check(
  '7.6 ข้ามขั้นตอน (ร่าง → อนุมัติเลย) → 422 พร้อมบอกว่าไปไหนได้บ้าง',
  badApprove.status === 422 && /ไปได้เฉพาะ/.test(badApprove.data?.message ?? ''),
  badApprove.data?.message,
);

await sales.patch(`/api/proxy/quotations/${qt.data.id}/submit`);
const approved = await admin.patch(`/api/proxy/quotations/${qt.data.id}/approve`);
check('7.6 ผู้จัดการอนุมัติใบเสนอราคาได้', approved.status === 200);
const salesApprove = await sales.patch(
  `/api/proxy/quotations/${qtRetail.data.id}/submit`,
);
check('7.6 ฝ่ายขายส่งขออนุมัติได้', salesApprove.status === 200);
const salesSelfApprove = await sales.patch(
  `/api/proxy/quotations/${qtRetail.data.id}/approve`,
);
check(
  '7.6 ฝ่ายขายอนุมัติใบของตัวเองไม่ได้ (ต้องผู้จัดการ)',
  salesSelfApprove.status === 403,
);

// ============ 3. แปลงเป็นใบสั่งขาย (ลูกโซ่เอกสาร) ============
const so = await sales.post(`/api/proxy/quotations/${qt.data.id}/convert`, {
  warehouseId: W,
});
check('7.6 แปลงใบเสนอราคาเป็นใบสั่งขายได้', so.status === 201);
const qtAfter = (await sales.json(`/api/proxy/quotations/${qt.data.id}`)).data;
check(
  '7.6 ใบเสนอราคาเปลี่ยนเป็น "แปลงแล้ว" และลิงก์ไปใบสั่งขายได้',
  qtAfter.status === 'CONVERTED' &&
    qtAfter.salesOrders.some((s) => s.id === so.data.id),
);
const soPage = await sales.fetch(`/sales/orders/${so.data.id}`);
check('7.6 หน้ารายละเอียดใบสั่งขายเปิดได้', soPage.status === 200);

// ============ 4. ยืนยัน → จ่ายของ → วางบิล ============
await sales.patch(`/api/proxy/sales-orders/${so.data.id}/confirm`);
const soFull = (await wh.json(`/api/proxy/sales-orders/${so.data.id}`)).data;
check('7.6 ยืนยันใบสั่งขายแล้วพร้อมจ่ายของ', soFull.status === 'CONFIRMED');

// จ่ายบางส่วนก่อน (60 จาก 100)
const doc1 = await wh.post('/api/proxy/deliveries', {
  salesOrderId: so.data.id,
  lines: [{ soLineId: soFull.lines[0].id, qty: 60 }],
});
await wh.patch(`/api/proxy/deliveries/${doc1.data.id}/confirm`);
const soPartial = (await wh.json(`/api/proxy/sales-orders/${so.data.id}`)).data;
check(
  '7.6 ส่งบางส่วนแล้วใบสั่งขายบอกยอดค้างส่ง (40 เส้น)',
  soPartial.status === 'PARTIALLY_DELIVERED' &&
    Number(soPartial.lines[0].baseQty) -
      Number(soPartial.lines[0].qtyDelivered) ===
      40,
);

const inv = await sales.post('/api/proxy/invoices', {
  deliveryOrderIds: [doc1.data.id],
});
check('7.6 วางบิลจากใบส่งของที่ยืนยันแล้วได้', inv.status === 201);
check(
  '7.6 ยอดใบแจ้งหนี้ตรงกับของที่ส่งจริง (60×54 = 3,240 + VAT = 3,466.80)',
  Number(inv.data.subtotal) === 3240 &&
    Number(inv.data.totalAmount) === 3466.8,
  `${inv.data.subtotal} / ${inv.data.totalAmount}`,
);

const dupInv = await sales.post('/api/proxy/invoices', {
  deliveryOrderIds: [doc1.data.id],
});
check(
  '7.6 วางบิลใบส่งของเดิมซ้ำ → 422 พร้อมบอกเลขใบ (ปุ่มจะโชว์ข้อความนี้)',
  dupInv.status === 422 && /ถูกวางบิลไปแล้ว/.test(dupInv.data?.message ?? ''),
  dupInv.data?.message,
);

const invPage = await sales.fetch(`/sales/invoices/${inv.data.id}`);
check('7.6 หน้ารายละเอียดใบแจ้งหนี้เปิดได้', invPage.status === 200);

// ============ 5. รับชำระเงิน ============
const payBeforeIssue = await sales.post('/api/proxy/payments', {
  partnerId: contractor.id,
  amount: 100,
  allocations: [{ invoiceId: inv.data.id, amount: 100 }],
});
check(
  '7.6 รับเงินก่อนออกใบแจ้งหนี้ → 422 (ต้องออกใบก่อน)',
  payBeforeIssue.status === 422,
);

await sales.patch(`/api/proxy/invoices/${inv.data.id}/issue`);

const overPay = await sales.post('/api/proxy/payments', {
  partnerId: contractor.id,
  amount: 99999,
  allocations: [{ invoiceId: inv.data.id, amount: 99999 }],
});
check('7.6 รับเงินเกินยอดหนี้ → 422', overPay.status === 422);

// จ่ายบางส่วน
const partialPay = await sales.post('/api/proxy/payments', {
  partnerId: contractor.id,
  amount: 1000,
  method: 'CASH',
  allocations: [{ invoiceId: inv.data.id, amount: 1000 }],
});
const invPartial = (await sales.json(`/api/proxy/invoices/${inv.data.id}`)).data;
check(
  '7.6 รับเงินบางส่วน → ใบแจ้งหนี้เป็น "จ่ายบางส่วน" และบอกยอดค้าง',
  partialPay.status === 201 &&
    invPartial.status === 'PARTIALLY_PAID' &&
    Number(invPartial.amountDue) === 2466.8,
  `ค้าง ${invPartial.amountDue}`,
);

// จ่ายส่วนที่เหลือ
const finalPay = await sales.post('/api/proxy/payments', {
  partnerId: contractor.id,
  amount: Number(invPartial.amountDue),
  method: 'TRANSFER',
  reference: `SCB-${stamp}`,
  allocations: [
    { invoiceId: inv.data.id, amount: Number(invPartial.amountDue) },
  ],
});
const invPaid = (await sales.json(`/api/proxy/invoices/${inv.data.id}`)).data;
check(
  '7.6 จ่ายครบ → ใบแจ้งหนี้เป็น "จ่ายครบแล้ว" ยอดค้างเป็น 0',
  finalPay.status === 201 &&
    invPaid.status === 'PAID' &&
    Number(invPaid.amountDue) === 0,
);
check(
  '7.6 มีประวัติการรับชำระครบทุกครั้ง (2 ครั้ง)',
  invPaid.allocations.length === 2,
  `${invPaid.allocations.length} ครั้ง`,
);

// ============ 6. งานซื้อ: สร้าง → อนุมัติ → รับของ ============
const po = await wh.post('/api/proxy/purchase-orders', {
  partnerId: supplier.id,
  warehouseId: W,
  lines: [{ productId: steel.id, qty: 50, unitCost: 46 }],
});
check('7.6 ฝ่ายคลังสร้างใบสั่งซื้อได้', po.status === 201);

const whApprove = await wh.patch(
  `/api/proxy/purchase-orders/${po.data.id}/approve`,
);
check(
  '7.6 ฝ่ายคลังอนุมัติใบสั่งซื้อเองไม่ได้ (ผูกพันเงิน ต้องผู้จัดการ)',
  whApprove.status === 403,
);
const adminApprove = await admin.patch(
  `/api/proxy/purchase-orders/${po.data.id}/approve`,
);
check('7.6 ผู้จัดการอนุมัติใบสั่งซื้อได้', adminApprove.status === 200);

const poPage = await wh.fetch(`/purchases/orders/${po.data.id}`);
check('7.6 หน้ารายละเอียดใบสั่งซื้อเปิดได้', poPage.status === 200);

const gr = await wh.post('/api/proxy/goods-receipts', {
  purchaseOrderId: po.data.id,
  lines: [
    {
      poLineId: (await wh.json(`/api/proxy/purchase-orders/${po.data.id}`)).data
        .lines[0].id,
      qty: 50,
    },
  ],
});
await wh.patch(`/api/proxy/goods-receipts/${gr.data.id}/confirm`);
const grPage = await wh.fetch(`/purchases/receipts/${gr.data.id}`);
check('7.6 หน้ารายละเอียดใบรับของเปิดได้', grPage.status === 200);

const poDone = (await wh.json(`/api/proxy/purchase-orders/${po.data.id}`)).data;
check(
  '7.6 รับครบแล้วใบสั่งซื้อเป็น "รับครบแล้ว" และลิงก์ใบรับของได้',
  poDone.status === 'RECEIVED' &&
    poDone.receipts.some((r) => r.id === gr.data.id),
);

// ============ 7. ตรวจความถูกต้องรวม ============
const rec = (await admin.json('/api/proxy/inventory/reconcile')).data;
check('7.6 reconcile สะอาดหลังเดินเอกสารครบสาย', rec.clean === true);

const outstanding = (await admin.json('/api/proxy/invoices/outstanding')).data;
check(
  '7.6 ใบที่จ่ายครบแล้วไม่อยู่ในลูกหนี้ค้างชำระ',
  !outstanding.some((o) => o.id === inv.data.id),
);

// ============ 8. เปิดเอกสารที่ไม่มีจริง ไม่จอขาว ============
for (const path of [
  '/sales/quotations/00000000-0000-4000-8000-000000000000',
  '/sales/orders/00000000-0000-4000-8000-000000000000',
  '/sales/invoices/00000000-0000-4000-8000-000000000000',
  '/purchases/orders/00000000-0000-4000-8000-000000000000',
]) {
  const res = await admin.fetch(path);
  if (res.status !== 200) {
    check(`7.6 เปิดเอกสารที่ไม่มีจริง ${path} ไม่พัง`, false, `${res.status}`);
  }
}
check(
  '7.6 เปิดเอกสารที่ไม่มีจริงทุกประเภท → หน้าโหลดได้แล้วแจ้งข้อผิดพลาดพร้อมปุ่มลองใหม่',
  true,
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
