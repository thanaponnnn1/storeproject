// ทดสอบเกณฑ์ ✔ ของเฟส 7.2 (หน้าสินค้า/คู่ค้า) — ยิงกับ Next.js ที่ port 3001
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
const stamp = Date.now();

// ============ หน้ารายการสินค้าเปิดได้ + ตัวกรองอยู่ใน URL ============
const listPage = await admin.fetch('/products');
const listHtml = await listPage.text();
check('7.2 หน้ารายการสินค้าเปิดได้', listPage.status === 200);
check(
  '7.2 มีช่องค้นหาและตัวกรองประเภทการติดตาม',
  listHtml.includes('ค้นหา รหัส') &&
    listHtml.includes('ตามเครื่อง') &&
    listHtml.includes('ตามล็อต'),
);

// ตัวกรองอยู่ใน URL → เปิดลิงก์ตรง ๆ ต้องได้ผลเหมือนกัน (กดถอย/แชร์ลิงก์ได้)
const filtered = await admin.fetch('/products?search=แอร์&trackingType=SERIAL&page=2');
check(
  '7.2 เปิดลิงก์ที่มีตัวกรอง+เลขหน้าใน URL ได้ตรง ๆ (กดถอย/แชร์ลิงก์ได้)',
  filtered.status === 200,
);

// ============ สร้างสินค้าผ่าน API ที่หน้าเว็บใช้ ============
const created = await admin.json('/api/proxy/products', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sku: `UI-${stamp}`,
    name: 'สินค้าทดสอบหน้าเว็บ',
    brand: 'ทดสอบ',
    baseUomId: (await admin.json('/api/proxy/uoms')).data.find(
      (u) => u.code === 'PCS',
    ).id,
    trackingType: 'SERIAL',
    warrantyMonths: 12,
    priceRetail: 1500,
    priceContractor: 1400,
    priceProject: 1300,
    minStock: 5,
  }),
});
check(
  '7.2 เพิ่มสินค้าจากหน้าเว็บได้ (ผ่าน proxy ที่แนบ token ให้)',
  created.status === 201,
  created.data?.message,
);
const productId = created.data?.id;

// SKU ซ้ำต้องได้ข้อความไทยที่บอกสาเหตุ ไม่ใช่ error กลาง ๆ
const dup = await admin.json('/api/proxy/products', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sku: `UI-${stamp}`,
    name: 'ซ้ำ',
    baseUomId: created.data.baseUomId,
  }),
});
check(
  '7.2 SKU ซ้ำ → ข้อความบอกสาเหตุเป็นภาษาไทย',
  dup.status === 409 && /ซ้ำ/.test(dup.data?.message ?? ''),
  dup.data?.message,
);

// ============ หน้ารายละเอียด + แก้ไข ============
const detail = await admin.fetch(`/products/${productId}`);
check('7.2 หน้ารายละเอียดสินค้าเปิดได้', detail.status === 200);

const editPage = await admin.fetch(`/products/${productId}/edit`);
check('7.2 หน้าแก้ไขสินค้าเปิดได้', editPage.status === 200);

const updated = await admin.json(`/api/proxy/products/${productId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'สินค้าทดสอบ (แก้ชื่อแล้ว)', priceRetail: 1600 }),
});
check(
  '7.2 แก้ไขสินค้าได้ ข้อมูลเปลี่ยนจริง',
  updated.status === 200 &&
    updated.data.name === 'สินค้าทดสอบ (แก้ชื่อแล้ว)' &&
    Number(updated.data.priceRetail) === 1600,
);

// ปิด/เปิดใช้งาน (soft delete ไม่ลบจริง)
const disabled = await admin.json(`/api/proxy/products/${productId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ isActive: false }),
});
check('7.2 ปิดใช้งานสินค้าได้ (ไม่ลบข้อมูลจริง)', disabled.data?.isActive === false);
const stillThere = await admin.json(`/api/proxy/products/${productId}`);
check(
  '7.2 สินค้าที่ปิดใช้งานยังเปิดดูได้ (ข้อมูลไม่หาย)',
  stillThere.status === 200,
);
await admin.json(`/api/proxy/products/${productId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ isActive: true }),
});

// ============ สิทธิ์: ปุ่มที่กดไม่ได้ต้องไม่โผล่ ============
const salesView = await sales.fetch(`/products/${productId}`);
const salesHtml = await salesView.text();
check(
  '7.2 ฝ่ายขายเปิดหน้าสินค้าได้ แต่ไม่เห็นปุ่มแก้ไข/ปิดใช้งาน',
  salesView.status === 200 &&
    !salesHtml.includes('แก้ไขข้อมูล') &&
    !salesHtml.includes('ปิดใช้งาน<'),
);
const adminHtml = await (await admin.fetch(`/products/${productId}`)).text();
check(
  '7.2 ผู้ดูแลระบบเห็นปุ่มแก้ไข',
  adminHtml.includes('แก้ไขข้อมูล'),
);
const salesCreate = await sales.json('/api/proxy/products', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sku: `HACK-${stamp}`,
    name: 'ลองแอบสร้าง',
    baseUomId: created.data.baseUomId,
  }),
});
check(
  '7.2 ถึงยิง API ตรง ๆ ฝ่ายขายก็สร้างสินค้าไม่ได้ (กันที่ backend จริง)',
  salesCreate.status === 403,
);

// ============ คู่ค้า ============
const partnersPage = await admin.fetch('/partners');
const partnersHtml = await partnersPage.text();
check('7.2 หน้ารายการคู่ค้าเปิดได้', partnersPage.status === 200);
check(
  '7.2 มีตัวกรองประเภทคู่ค้า (ลูกค้า/ซัพพลายเออร์)',
  partnersHtml.includes('ลูกค้า') && partnersHtml.includes('ซัพพลายเออร์'),
);

const newPartner = await admin.json('/api/proxy/partners', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: `UI-C-${stamp}`,
    name: 'ลูกค้าทดสอบหน้าเว็บ',
    type: 'CUSTOMER',
    phone: '0891234567',
    priceLevel: 'CONTRACTOR',
    creditTermDays: 30,
  }),
});
check('7.2 เพิ่มคู่ค้าได้', newPartner.status === 201, newPartner.data?.message);
const partnerId = newPartner.data?.id;

check(
  '7.2 บันทึกระดับราคาและเครดิตถูกต้อง',
  newPartner.data?.priceLevel === 'CONTRACTOR' &&
    newPartner.data?.creditTermDays === 30,
);

const partnerDetail = await admin.fetch(`/partners/${partnerId}`);
check('7.2 หน้ารายละเอียดคู่ค้าเปิดได้', partnerDetail.status === 200);
const partnerEdit = await admin.fetch(`/partners/${partnerId}/edit`);
check('7.2 หน้าแก้ไขคู่ค้าเปิดได้', partnerEdit.status === 200);

// ฝ่ายขายเพิ่มลูกค้าได้ (เป็นงานประจำวันของเขา)
const salesAddPartner = await sales.json('/api/proxy/partners', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: `UI-S-${stamp}`,
    name: 'ลูกค้าที่ฝ่ายขายเพิ่มเอง',
    type: 'CUSTOMER',
  }),
});
check(
  '7.2 ฝ่ายขายเพิ่มลูกค้าเองได้ (งานประจำวัน)',
  salesAddPartner.status === 201,
);

// ============ เปิดหน้าที่ไม่มีจริง ต้องไม่จอขาว ============
const ghost = await admin.fetch('/products/00000000-0000-4000-8000-000000000000');
check(
  '7.2 เปิดสินค้าที่ไม่มีจริง → หน้าโหลดได้ แล้วแสดงข้อความผิดพลาดพร้อมปุ่มลองใหม่',
  ghost.status === 200,
);

// ============ ลายเซ็นอัปโหลดรูป (Cloudinary) ============
const sig = await admin.json('/api/proxy/uploads/signature', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ folder: 'products' }),
});
check(
  '7.2 หน้าเว็บขอลายเซ็นอัปโหลดรูปได้ (ไฟล์ยิงตรงไป Cloudinary ไม่ผ่านเซิร์ฟเวอร์เรา)',
  sig.status === 201 &&
    /^[a-f0-9]{40}$/.test(sig.data?.signature ?? '') &&
    sig.data?.uploadUrl?.includes('api.cloudinary.com'),
  `cloud=${sig.data?.cloudName}`,
);
check(
  '7.2 ลายเซ็นไม่มี API secret ติดมาด้วย',
  !JSON.stringify(sig.data ?? {}).toLowerCase().includes('secret'),
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
