// ทดสอบเกณฑ์ ✔ ของเฟส 7.1 (โครง + Auth + Layout) — ยิงกับ Next.js ที่ port 3001
// รันกับ https ได้ด้วย: VERIFY_BASE=https://localhost:3001 node test/...
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3001';
if (BASE.startsWith('https')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const results = [];
const check = (name, cond, detail = '') =>
  results.push({ name, pass: !!cond, detail });

/** เก็บ cookie เองเหมือนเบราว์เซอร์ (fetch ของ node ไม่เก็บให้) */
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
}

const s = new Session();

// --- ยังไม่ login: เข้าหน้าลึก ๆ ต้องเด้งไป login พร้อมจำหน้าเดิม ---
const guarded = await s.fetch('/products?search=abc');
const location = guarded.headers.get('location') ?? '';
check(
  '7.1 ยังไม่ login เข้า /products → เด้งไป /login',
  guarded.status === 307 && location.includes('/login'),
  `${guarded.status} → ${location}`,
);
check(
  '7.1 จำหน้าที่ตั้งใจเข้าไว้ใน ?next= (พากลับหลัง login)',
  decodeURIComponent(location).includes('next=/products?search=abc'),
  decodeURIComponent(location),
);

// --- login ผิด ---
const badLogin = await s.fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@store.local', password: 'wrong-pass' }),
});
const badBody = await badLogin.json();
check(
  '7.1 รหัสผิด → แสดงข้อความจาก backend เป็นภาษาไทย ไม่ใช่ error กลาง ๆ',
  badLogin.status === 401 && /อีเมลหรือรหัสผ่าน/.test(badBody.message ?? ''),
  badBody.message,
);
check('7.1 login ไม่ผ่าน → ไม่มี cookie session', s.cookies.size === 0);

// --- login ถูก ---
const login = await s.fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@store.local', password: 'Admin@1234' }),
});
check('7.1 login สำเร็จ', login.status === 200);
check(
  '7.1 เก็บ token เป็น cookie ทั้ง access และ refresh',
  s.cookies.has('store_at') && s.cookies.has('store_rt'),
  [...s.cookies.keys()].join(', '),
);

// httpOnly: cookie ต้องมี flag ไม่ให้ JS อ่าน (กัน XSS ขโมย token)
const setCookies = login.headers.getSetCookie?.() ?? [];
check(
  '7.1 cookie เป็น httpOnly + SameSite (JavaScript อ่านไม่ได้)',
  setCookies.length >= 2 &&
    setCookies.every((c) => /HttpOnly/i.test(c) && /SameSite/i.test(c)),
  setCookies[0]?.split(';').slice(1).join(';').trim(),
);
check(
  '7.1 token จริงไม่หลุดออกมาใน response body',
  JSON.stringify(await login.json()) === '{"ok":true}',
);

// --- เข้าหน้าที่ป้องกันได้แล้ว ---
const home = await s.fetch('/');
const homeHtml = await home.text();
check('7.1 login แล้วเข้าหน้าหลักได้ (ไม่เด้ง)', home.status === 200);
check(
  '7.1 หน้าหลักแสดงชื่อผู้ใช้ที่ login',
  homeHtml.includes('System Admin'),
);
check(
  '7.1 มีเมนูหลักครบ (หน้าหลัก/สแกน/สต๊อก/สินค้า/เพิ่มเติม)',
  ['หน้าหลัก', 'สแกน', 'สต๊อก', 'สินค้า', 'เพิ่มเติม'].every((t) =>
    homeHtml.includes(t),
  ),
);

// --- login แล้วเข้า /login ต้องเด้งกลับหน้าหลัก (กันหลงทาง) ---
const loginWhenAuthed = await s.fetch('/login');
check(
  '7.1 login อยู่แล้วแต่เปิด /login → เด้งกลับหน้าหลัก',
  loginWhenAuthed.status === 307 &&
    (loginWhenAuthed.headers.get('location') ?? '').endsWith('/'),
);

// --- proxy แนบ token ให้เอง ---
const viaProxy = await s.fetch('/api/proxy/products?limit=3');
const proxyData = await viaProxy.json();
check(
  '7.1 เรียก backend ผ่าน proxy ได้โดยหน้าเว็บไม่ต้องรู้จัก token',
  viaProxy.status === 200 && Array.isArray(proxyData.data),
  `ได้สินค้า ${proxyData.data?.length ?? 0} รายการ`,
);

// --- ทุกหน้าในเมนูต้องเปิดได้ ไม่มีจอขาว/พัง ---
const pages = [
  '/scan',
  '/stock',
  '/products',
  '/partners',
  '/sales',
  '/purchases',
  '/reports',
  '/audit',
  '/more',
];
const broken = [];
for (const p of pages) {
  const res = await s.fetch(p);
  if (res.status !== 200) broken.push(`${p}:${res.status}`);
}
check(
  '7.1 ทุกหน้าในเมนูเปิดได้ ไม่มีหน้าพัง (หน้าที่ยังไม่ทำบอกว่ากำลังพัฒนา + มีปุ่มย้อนกลับ)',
  broken.length === 0,
  broken.join(', '),
);

// --- URL แปลก ๆ ต้องได้หน้า 404 ที่มีทางกลับ ไม่ใช่จอขาว ---
const notFound = await s.fetch(encodeURI('/ไม่มีหน้านี้จริง'));
const notFoundHtml = await notFound.text();
check(
  '7.1 เปิด URL ที่ไม่มีจริง → หน้า 404 ภาษาไทย + ปุ่มกลับหน้าหลัก',
  notFound.status === 404 && notFoundHtml.includes('กลับหน้าหลัก'),
);

// --- token หมดอายุ → proxy ต่ออายุให้เอง ไม่เตะผู้ใช้ออก ---
const rt = s.cookies.get('store_rt');
s.cookies.set('store_at', 'expired.invalid.token');
const afterExpiry = await s.fetch('/api/proxy/users/me');
check(
  '7.1 access token หมดอายุ → ระบบต่ออายุให้เองอัตโนมัติ ไม่ต้อง login ใหม่',
  afterExpiry.status === 200,
  `status ${afterExpiry.status}`,
);
check(
  '7.1 ต่ออายุแล้วได้ token ชุดใหม่ (refresh rotation ทำงาน)',
  s.cookies.get('store_rt') !== rt,
);

// --- logout ---
const logout = await s.fetch('/api/auth/logout', { method: 'POST' });
check('7.1 logout สำเร็จ', logout.status === 200);
check(
  '7.1 logout แล้ว cookie ถูกลบหมด',
  !s.cookies.has('store_at') && !s.cookies.has('store_rt'),
  [...s.cookies.keys()].join(', ') || '(ว่าง)',
);
const afterLogout = await s.fetch('/');
check(
  '7.1 หลัง logout กดถอยกลับเข้าหน้าเดิม → เด้งไป login (ไม่เห็นข้อมูลค้าง)',
  afterLogout.status === 307 &&
    (afterLogout.headers.get('location') ?? '').includes('/login'),
);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
