// ทดสอบเกณฑ์ ✔ ของเฟส 7.4 (สแกนบาร์โค้ด) — ยิงกับ Next.js ที่ port 3001
// กล้องจริงทดสอบอัตโนมัติไม่ได้ จึงทดสอบ "สิ่งที่เกิดหลังยิงติด" ให้ครบทุกเส้นทาง
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
/** จำลองสิ่งที่หน้าสแกนทำหลังกล้องอ่านรหัสได้: หาสินค้าก่อน ไม่เจอค่อยหา serial */
async function scan(session, code) {
  const byBarcode = await session.json(
    `/api/proxy/products/by-barcode/${encodeURIComponent(code)}`,
  );
  if (byBarcode.status === 200) return { kind: 'product', ...byBarcode.data };

  const bySerial = await session.json(
    `/api/proxy/inventory/serials/${encodeURIComponent(code)}`,
  );
  if (bySerial.status === 200) return { kind: 'serial', ...bySerial.data };

  return { kind: 'notfound' };
}

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
const customer = (
  await admin.json('/api/proxy/partners?type=CUSTOMER')
).data.data.find((p) => p.code === 'C-0002');

// ============ หน้าสแกนเปิดได้ + มีทางสำรอง ============
const scanPage = await admin.fetch('/scan');
const scanHtml = await scanPage.text();
check('7.4 หน้าสแกนเปิดได้', scanPage.status === 200);
check(
  '7.4 มีปุ่มเริ่มสแกนและคำแนะนำการเล็ง',
  scanHtml.includes('เริ่มสแกน') && scanHtml.includes('เล็งบาร์โค้ดให้อยู่ในกรอบ'),
);
check(
  '7.4 มีช่องพิมพ์รหัสด้วยมือเป็นทางสำรอง (บาร์โค้ดเลอะ/กล้องเสียก็ทำงานต่อได้)',
  scanHtml.includes('หรือพิมพ์รหัส/serial ด้วยมือ'),
);
check(
  '7.4 บอกด้วยว่ายิง serial เช็คประกันได้',
  scanHtml.includes('serial บนตัวเครื่องเพื่อเช็คประกัน'),
);

// ============ เตรียมสินค้าหลายหน่วย + บาร์โค้ด ============
const steel = (
  await admin.post('/api/proxy/products', {
    sku: `S74-STL-${stamp}`,
    name: 'เหล็กเส้นทดสอบสแกน',
    baseUomId: uomBar,
    priceRetail: 58,
    units: [{ uomId: uomBundle, conversionFactor: 10, salePrice: 520 }],
  })
).data;
const bundleUnitId = steel.units[0].id;

const factoryBarcode = `885${stamp.toString().slice(-10)}`;
await admin.post(`/api/proxy/products/${steel.id}/barcodes`, {
  barcode: factoryBarcode,
});
await admin.post(`/api/proxy/products/${steel.id}/barcodes`, {}); // QR หน่วยฐาน
await admin.post(`/api/proxy/products/${steel.id}/barcodes`, {
  productUnitId: bundleUnitId,
}); // QR หน่วยมัด

await wh.post('/api/proxy/inventory/receipts', {
  productId: steel.id,
  warehouseId: W,
  qty: 120,
  unitCost: 45,
  refDocId: `S74-GR-${stamp}`,
});

// ============ ยิงบาร์โค้ดโรงงาน ============
const hit1 = await scan(admin, factoryBarcode);
check(
  '7.4 ยิงบาร์โค้ดโรงงาน → เจอสินค้าถูกตัว',
  hit1.kind === 'product' && hit1.product.sku === steel.sku,
);
check(
  '7.4 บอกยอดคงเหลือทันที (120 เส้น)',
  Number(hit1.stock?.[0]?.qtyOnHand) === 120,
  `${hit1.stock?.[0]?.qtyOnHand}`,
);
check(
  '7.4 บอกราคาขายของหน่วยที่ยิง',
  Number(hit1.scannedUnit?.salePrice ?? hit1.product.priceRetail) === 58,
);

// ============ ยิง QR ของร้าน (ของไม่มีบาร์โค้ดโรงงาน) ============
const hitBase = await scan(admin, `INT:${steel.sku}:BAR`);
check(
  '7.4 ยิง QR ที่ร้านพิมพ์เอง (หน่วยเส้น) → ได้หน่วยฐาน ตัวคูณ 1',
  hitBase.kind === 'product' &&
    hitBase.scannedUnit.uom.code === 'BAR' &&
    Number(hitBase.scannedUnit.conversionFactor) === 1,
);

const hitBundle = await scan(admin, `INT:${steel.sku}:BUNDLE`);
check(
  '7.4 ยิง QR หน่วยมัด → รู้ว่าเป็นมัด ตัวคูณ 10',
  hitBundle.kind === 'product' &&
    hitBundle.scannedUnit.uom.code === 'BUNDLE' &&
    Number(hitBundle.scannedUnit.conversionFactor) === 10,
);
check(
  '7.4 แปลงยอดคงเหลือเป็นหน่วยที่ยิงให้ (120 เส้น = 12 มัด)',
  Number(hitBundle.stock[0].qtyOnHand) === 120 &&
    Number(hitBundle.stock[0].qtyInScannedUnit) === 12,
  `${hitBundle.stock[0].qtyOnHand} เส้น = ${hitBundle.stock[0].qtyInScannedUnit} มัด`,
);
check(
  '7.4 ยิงหน่วยมัดได้ราคาต่อมัด (520 ไม่ใช่ 58)',
  Number(hitBundle.scannedUnit.salePrice) === 520,
);

// ============ ยิง serial เช็คประกัน (หน้าเคลม) ============
const ac = (
  await admin.post('/api/proxy/products', {
    sku: `S74-AC-${stamp}`,
    name: 'แอร์ทดสอบสแกน',
    brand: 'Daikin',
    baseUomId: uomEA,
    trackingType: 'SERIAL',
    warrantyMonths: 12,
    priceRetail: 14900,
  })
).data;
const SN = (n) => `S74SN-${stamp}-${n}`;
await wh.post('/api/proxy/inventory/receipts', {
  productId: ac.id,
  warehouseId: W,
  qty: 2,
  unitCost: 12000,
  refDocId: `S74-GRAC-${stamp}`,
  serials: [SN(1), SN(2)],
});

const inStock = await scan(admin, SN(2));
check(
  '7.4 ยิง serial เครื่องที่ยังไม่ขาย → บอกว่าอยู่ในคลัง ยังไม่เริ่มนับประกัน',
  inStock.kind === 'serial' &&
    inStock.status === 'IN_STOCK' &&
    inStock.warranty.inWarranty === false,
);

await wh.post('/api/proxy/inventory/issues', {
  productId: ac.id,
  warehouseId: W,
  qty: 1,
  refDocId: `S74-DO-${stamp}`,
  serials: [SN(1)],
  soldToPartnerId: customer.id,
});

const sold = await scan(admin, SN(1));
check(
  '7.4 ยิง serial เครื่องที่ขายแล้ว → รู้ทันทีว่าใครซื้อ ประกันเหลือกี่วัน',
  sold.kind === 'serial' &&
    sold.status === 'SOLD' &&
    sold.soldToPartner?.code === 'C-0002' &&
    sold.warranty.inWarranty === true &&
    sold.warranty.daysLeft > 300,
  `ลูกค้า ${sold.soldToPartner?.name} · ประกันเหลือ ${sold.warranty?.daysLeft} วัน`,
);
check(
  '7.4 มีเบอร์โทรลูกค้าให้กดโทรกลับได้เลย',
  Boolean(sold.soldToPartner?.phone),
  sold.soldToPartner?.phone,
);

// ============ ยิงรหัสที่ไม่มีในระบบ ============
const missing = await scan(admin, `NOPE-${stamp}`);
check(
  '7.4 ยิงรหัสที่ไม่มีในระบบ → ไม่พังและบอกให้ไปค้นหาต่อได้',
  missing.kind === 'notfound',
);

// ============ ฝ่ายคลังใช้หน้าสแกนได้ (คนใช้จริงหน้างาน) ============
const whScanPage = await wh.fetch('/scan');
check('7.4 ฝ่ายคลังเข้าหน้าสแกนได้', whScanPage.status === 200);
const whHit = await scan(wh, factoryBarcode);
check(
  '7.4 ฝ่ายคลังยิงบาร์โค้ดดูยอดคงเหลือได้',
  whHit.kind === 'product' && Number(whHit.stock[0].qtyOnHand) === 120,
);

// ============ ความเร็ว: หน้างานยิงรัว ๆ ต้องตอบไว ============
// วอร์มอัพก่อน เพราะ dev server คอมไพล์ route ตอนเรียกครั้งแรก
for (let i = 0; i < 3; i++) await scan(wh, factoryBarcode);
const t0 = Date.now();
for (let i = 0; i < 5; i++) await scan(wh, factoryBarcode);
const avg = (Date.now() - t0) / 5;
// เกณฑ์นี้วัดผ่าน dev server ซึ่งช้ากว่าของจริงหลาย เท่า (backend เองตอบใน <100ms)
// ตั้งไว้กว้างเพื่อจับปัญหาจริง เช่น query ซ้ำซ้อน ไม่ใช่จับความช้าของ dev mode
check(
  '7.4 ค้นหาหลังยิงเร็วพอใช้งานรัว ๆ (ผ่าน dev server ต่ำกว่า 600ms)',
  avg < 600,
  `เฉลี่ย ${Math.round(avg)}ms/ครั้ง (dev mode — ของจริงเร็วกว่านี้มาก)`,
);

// ============ สินค้าที่ยังไม่มีของ ต้องบอกตรง ๆ ไม่ใช่เงียบ ============
const empty = (
  await admin.post('/api/proxy/products', {
    sku: `S74-EMPTY-${stamp}`,
    name: 'สินค้าที่ยังไม่เคยรับเข้า',
    baseUomId: uomBar,
    priceRetail: 10,
  })
).data;
await admin.post(`/api/proxy/products/${empty.id}/barcodes`, {});
const emptyHit = await scan(admin, `INT:${empty.sku}:BAR`);
check(
  '7.4 ยิงสินค้าที่ยังไม่เคยรับเข้า → เจอสินค้าแต่บอกว่ายังไม่มีของ',
  emptyHit.kind === 'product' && emptyHit.stock.length === 0,
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
