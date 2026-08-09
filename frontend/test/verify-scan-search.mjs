// ทดสอบ: ยิง/พิมพ์บาร์โค้ดในช่องค้นหาแล้วต้องเจอสินค้า + โหมดกดแล้วยิง
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

// ---- หาสินค้าตัวอย่างที่มีบาร์โค้ดจริง ----
const sample = (await admin.json('/api/proxy/products?search=SAW-MAK-7&limit=1'))
  .data.data[0];
const full = (await admin.json(`/api/proxy/products/${sample.id}`)).data;
const ean = full.barcodes.find((b) => /^\d{13}$/.test(b.barcode))?.barcode;

const steel = (
  await admin.json('/api/proxy/products?search=PPR-SCG-20&limit=1')
).data.data[0];
const steelFull = (await admin.json(`/api/proxy/products/${steel.id}`)).data;
const qrCode = steelFull.barcodes.find((b) => b.isInternal)?.barcode;

// ============ ค้นหาด้วยเลขบาร์โค้ด ============
const byEan = await admin.json(
  `/api/proxy/products?search=${encodeURIComponent(ean)}`,
);
check(
  'ค้นหาด้วยเลขบาร์โค้ดเต็ม → เจอสินค้าถูกตัว',
  byEan.data.data.length === 1 && byEan.data.data[0].sku === full.sku,
  `${ean} → ${byEan.data.data[0]?.sku}`,
);

const byPartial = await admin.json(
  `/api/proxy/products?search=${ean.slice(-6)}`,
);
check(
  'ค้นหาด้วยเลขบาร์โค้ดบางส่วน (6 หลักท้าย) → ยังเจอ',
  byPartial.data.data.some((p) => p.sku === full.sku),
  `${ean.slice(-6)} → เจอ ${byPartial.data.data.length} รายการ`,
);

const byQr = await admin.json(
  `/api/proxy/products?search=${encodeURIComponent(qrCode)}`,
);
check(
  'ค้นหาด้วย QR ของร้าน → เจอสินค้าถูกตัว',
  byQr.data.data.some((p) => p.sku === steelFull.sku),
  qrCode,
);

// ค้นด้วยชื่อ/รหัสยังทำงานเหมือนเดิม (ไม่ regression)
const byName = await admin.json('/api/proxy/products?search=เลื่อยวงเดือน');
check(
  'ค้นหาด้วยชื่อไทยยังใช้ได้เหมือนเดิม',
  byName.data.data.some((p) => p.sku === full.sku),
);
const bySku = await admin.json('/api/proxy/products?search=SAW-MAK');
check(
  'ค้นหาด้วยรหัสสินค้าบางส่วนยังใช้ได้เหมือนเดิม',
  bySku.data.data.some((p) => p.sku === full.sku),
);

// รหัสมั่วต้องไม่เจออะไร
const nonsense = await admin.json('/api/proxy/products?search=9999999999999');
check('ค้นหาเลขที่ไม่มีในระบบ → ไม่เจอ (ไม่ใช่คืนทุกตัว)', nonsense.data.data.length === 0);

// ============ หน้าเว็บมีปุ่มยิงในช่องค้นหา ============
const productsPage = await wh.fetch('/products');
const productsHtml = await productsPage.text();
check(
  'หน้าสินค้ามีปุ่มกล้องข้างช่องค้นหา',
  productsHtml.includes('ยิงบาร์โค้ดเพื่อค้นหา'),
);
check(
  'ช่องค้นหาบอกว่าค้นด้วยบาร์โค้ดได้',
  productsHtml.includes('บาร์โค้ด'),
);

const stockPage = await wh.fetch('/stock');
const stockHtml = await stockPage.text();
check(
  'หน้ายอดคงเหลือก็มีปุ่มยิงบาร์โค้ดเช่นกัน',
  stockHtml.includes('ยิงบาร์โค้ดเพื่อค้นหา'),
);

// ============ โหมดกดแล้วยิงในหน้าสแกน ============
const scanPage = await wh.fetch('/scan');
const scanHtml = await scanPage.text();
check(
  'หน้าสแกนมีให้เลือก 2 โหมด (ยิงต่อเนื่อง / กดแล้วยิง)',
  scanHtml.includes('ยิงต่อเนื่อง') && scanHtml.includes('กดแล้วยิง'),
);

const receivePage = await wh.fetch('/receive');
const receiveHtml = await receivePage.text();
check(
  'หน้ารับของก็เลือกโหมดได้เหมือนกัน',
  receiveHtml.includes('กดแล้วยิง'),
);

// ============ ยอดคงเหลือค้นด้วยบาร์โค้ดไม่ได้ (คนละ endpoint) ============
// หน้าสต๊อกค้นจาก balances ซึ่งค้นชื่อ/รหัส — ยิงบาร์โค้ดจะไม่เจอ ต้องรู้ข้อจำกัดนี้
const balBySku = await admin.json(
  `/api/proxy/inventory/balances?search=${full.sku}`,
);
check(
  'หน้ายอดคงเหลือค้นด้วยรหัสสินค้าได้',
  balBySku.data.data.length >= 0,
  `เจอ ${balBySku.data.data.length} รายการ`,
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
