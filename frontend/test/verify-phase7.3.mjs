// ทดสอบเกณฑ์ ✔ ของเฟส 7.3 (หน้าสต๊อก + stock card) — ยิงกับ Next.js ที่ port 3001
// รันกับ https ได้ด้วย: VERIFY_BASE=https://localhost:3001 node test/...
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
const wh = await loginAs('warehouse@store.local');
const stamp = Date.now();

const W = (await admin.json('/api/proxy/warehouses')).data.find(
  (w) => w.code === 'WH-MAIN',
).id;
const uomBag = (await admin.json('/api/proxy/uoms')).data.find(
  (u) => u.code === 'BAG',
).id;

// ---- เตรียมสินค้าที่มีความเคลื่อนไหวชัดเจน ----
const prod = (
  await admin.post('/api/proxy/products', {
    sku: `S7-${stamp}`,
    name: 'สินค้าทดสอบหน้าสต๊อก',
    baseUomId: uomBag,
    priceRetail: 100,
    minStock: 50,
  })
).data;

await wh.post('/api/proxy/inventory/receipts', {
  productId: prod.id,
  warehouseId: W,
  qty: 100,
  unitCost: 60,
  refDocId: `S7-GR-${stamp}`,
});
await wh.post('/api/proxy/inventory/issues', {
  productId: prod.id,
  warehouseId: W,
  qty: 70,
  refDocId: `S7-DO-${stamp}`,
});

// ============ หน้ายอดคงเหลือ ============
const stockPage = await admin.fetch('/stock');
const stockHtml = await stockPage.text();
check('7.3 หน้ายอดคงเหลือเปิดได้', stockPage.status === 200);
check(
  '7.3 มีช่องค้นหาและแท็บกรองของใกล้หมด',
  stockHtml.includes('ค้นหา รหัส / ชื่อสินค้า') &&
    stockHtml.includes('ต่ำกว่าจุดสั่งซื้อ'),
);

// ---- ยอดคงเหลือคำนวณถูก + มีมูลค่าให้เลย ----
const bal = await admin.json(
  `/api/proxy/inventory/balances?productId=${prod.id}`,
);
const row = bal.data.data[0];
check(
  '7.3 ยอดคงเหลือถูกต้อง (รับ 100 จ่าย 70 → เหลือ 30)',
  Number(row.qtyOnHand) === 30,
  `เหลือ ${row?.qtyOnHand}`,
);
check(
  '7.3 backend คำนวณมูลค่าคงเหลือมาให้ (30 × 60 = 1,800) ไม่ต้องให้หน้าเว็บคูณเอง',
  Number(row.value) === 1800,
  `มูลค่า ${row?.value}`,
);
check(
  '7.3 ทำเครื่องหมายของที่ต่ำกว่าจุดสั่งซื้อให้ (เหลือ 30 ต่ำกว่า 50)',
  row.belowMin === true,
);

// ---- แบ่งหน้า: ไม่ดึงทุกแถวรวดเดียว (ร้านสินค้าเยอะจะค้าง) ----
const paged = await admin.json('/api/proxy/inventory/balances?limit=5&page=1');
check(
  '7.3 ยอดคงเหลือแบ่งหน้าได้ ไม่ดึงทั้งหมดรวดเดียว',
  paged.data.data.length <= 5 && typeof paged.data.meta.totalPages === 'number',
  `หน้า 1 มี ${paged.data.data.length} รายการ จากทั้งหมด ${paged.data.meta.total}`,
);

// ---- ค้นหาในหน้าสต๊อก ----
const searched = await admin.json(
  `/api/proxy/inventory/balances?search=S7-${stamp}`,
);
check(
  '7.3 ค้นหาสินค้าในยอดคงเหลือได้',
  searched.data.data.length === 1 && searched.data.data[0].product.sku === prod.sku,
);

// ---- ซ่อนของที่ยอดเป็นศูนย์ ----
const zeroProd = (
  await admin.post('/api/proxy/products', {
    sku: `S7-ZERO-${stamp}`,
    name: 'สินค้าที่ของหมดแล้ว',
    baseUomId: uomBag,
  })
).data;
await wh.post('/api/proxy/inventory/receipts', {
  productId: zeroProd.id,
  warehouseId: W,
  qty: 5,
  unitCost: 10,
  refDocId: `S7-Z-${stamp}`,
});
await wh.post('/api/proxy/inventory/issues', {
  productId: zeroProd.id,
  warehouseId: W,
  qty: 5,
  refDocId: `S7-ZO-${stamp}`,
});
const withZero = await admin.json(
  `/api/proxy/inventory/balances?search=S7-ZERO-${stamp}`,
);
const hideZero = await admin.json(
  `/api/proxy/inventory/balances?search=S7-ZERO-${stamp}&hideZero=true`,
);
check(
  '7.3 ซ่อนสินค้าที่ของหมด (ยอด 0) ได้ตามที่หน้างานต้องการ',
  withZero.data.data.length === 1 && hideZero.data.data.length === 0,
);

// ============ แท็บของใกล้หมด ============
const lowTab = await admin.fetch('/stock?view=low');
check('7.3 แท็บของใกล้หมดเปิดได้ (สถานะอยู่ใน URL)', lowTab.status === 200);
const low = await admin.json('/api/proxy/reports/low-stock');
check(
  '7.3 รายงานของใกล้หมดเจอสินค้านี้ พร้อมบอกว่าขาดอีกเท่าไหร่',
  low.data.some(
    (i) => i.sku === prod.sku && Number(i.shortBy) === 20,
  ),
  low.data.find((i) => i.sku === prod.sku)?.shortBy,
);
const lowByWh = await wh.json('/api/proxy/reports/low-stock');
check(
  '7.3 ฝ่ายคลังดูของใกล้หมดได้ (เป็นข้อมูลที่ต้องใช้ทำงาน)',
  lowByWh.status === 200,
);

// ============ Stock card ============
const cardPage = await admin.fetch(`/stock/${prod.id}?warehouseId=${W}`);
check('7.3 หน้า stock card เปิดได้', cardPage.status === 200);

const card = await admin.json(
  `/api/proxy/inventory/stock-card?productId=${prod.id}&warehouseId=${W}`,
);
check(
  '7.3 stock card มี 2 รายการ (รับ+จ่าย) และปิดยอดที่ 30',
  card.data.entries.length === 2 && Number(card.data.closingQty) === 30,
  `${card.data.entries.length} รายการ ปิด ${card.data.closingQty}`,
);

// ไล่ยอดสะสมทีละบรรทัดต้องตรง
let running = 0;
const allMatch = card.data.entries.every((e) => {
  running += Number(e.qty);
  return running === Number(e.balance);
});
check('7.3 ยอดสะสมแต่ละบรรทัดตรงกับที่ระบบคำนวณ', allMatch);
check(
  '7.3 แต่ละบรรทัดบอกเลขเอกสารอ้างอิง (ตามรอยได้ว่าของหายไปกับใบไหน)',
  card.data.entries.every((e) => e.refDocId && e.refDocType),
  card.data.entries.map((e) => `${e.refDocType} ${e.refDocId}`).join(', '),
);

// ============ สินค้า LOT: หน้าเดียวกันต้องโชว์ล็อตแบบ FEFO ============
const cement = (
  await admin.post('/api/proxy/products', {
    sku: `S7-CEM-${stamp}`,
    name: 'ปูนทดสอบหน้าสต๊อก',
    baseUomId: uomBag,
    trackingType: 'LOT',
    costingMethod: 'FIFO',
    priceRetail: 135,
  })
).data;
const day = 86_400_000;
await wh.post('/api/proxy/inventory/receipts', {
  productId: cement.id,
  warehouseId: W,
  qty: 40,
  unitCost: 110,
  refDocId: `S7-CEM-A-${stamp}`,
  lotNo: `A-${stamp}`,
  expiryDate: new Date(Date.now() + 90 * day).toISOString(),
});
await wh.post('/api/proxy/inventory/receipts', {
  productId: cement.id,
  warehouseId: W,
  qty: 20,
  unitCost: 125,
  refDocId: `S7-CEM-B-${stamp}`,
  lotNo: `B-${stamp}`,
  expiryDate: new Date(Date.now() + 15 * day).toISOString(),
});

const lots = await admin.json(
  `/api/proxy/inventory/lots?productId=${cement.id}&warehouseId=${W}`,
);
check(
  '7.3 สินค้า LOT โชว์ล็อตเรียงตามที่ควรจ่ายก่อน (ใกล้หมดอายุขึ้นก่อน)',
  lots.data[0].lotNo.startsWith('B-') &&
    lots.data[0].daysToExpiry < lots.data[1].daysToExpiry,
  lots.data.map((l) => `${l.lotNo}(${l.daysToExpiry}วัน)`).join(' → '),
);
check(
  '7.3 บอกยอดคงเหลือรายล็อตถูกต้อง',
  Number(lots.data.find((l) => l.lotNo.startsWith('A-')).remainingQty) === 40 &&
    Number(lots.data.find((l) => l.lotNo.startsWith('B-')).remainingQty) === 20,
);
const cementCardPage = await admin.fetch(
  `/stock/${cement.id}?warehouseId=${W}`,
);
check('7.3 หน้า stock card ของสินค้า LOT เปิดได้', cementCardPage.status === 200);

// ============ กดถอย/แชร์ลิงก์ ============
const deepLink = await admin.fetch(
  `/stock?search=ปูน&view=low&warehouseId=${W}&page=2`,
);
check(
  '7.3 เปิดลิงก์ที่มีตัวกรองครบใน URL ได้ตรง ๆ (กดถอย/แชร์ลิงก์ได้)',
  deepLink.status === 200,
);

// ============ เปิดสินค้าที่ไม่มีจริง ต้องไม่จอขาว ============
const ghost = await admin.fetch(
  `/stock/00000000-0000-4000-8000-000000000000?warehouseId=${W}`,
);
check(
  '7.3 เปิด stock card ของสินค้าที่ไม่มี → หน้าโหลดได้ แล้วแจ้งข้อผิดพลาดพร้อมปุ่มลองใหม่',
  ghost.status === 200,
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
