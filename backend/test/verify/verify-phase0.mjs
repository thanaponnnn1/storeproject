// ทดสอบเกณฑ์ ✔ ของเฟส 0 ตาม STEPS.md — รันกับ API ที่ localhost:3009
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

function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
}

// --- health ---
const hz = await req('GET', '/healthz');
check('healthz = ok', hz.status === 200 && hz.data?.status === 'ok');
const rz = await req('GET', '/readyz');
check('readyz ต่อ DB ได้', rz.status === 200 && rz.data?.status === 'ready');

// --- auth: login ---
const noToken = await req('GET', '/api/users/me');
check('ไม่มี token → 401', noToken.status === 401);

const badLogin = await req('POST', '/api/auth/login', {
  email: 'admin@store.local',
  password: 'wrong-password',
});
check('รหัสผิด → 401', badLogin.status === 401);

const extraField = await req('POST', '/api/auth/login', {
  email: 'admin@store.local',
  password: 'Admin@1234',
  hacker: 'field',
});
check('field แปลกปลอม → 400 (whitelist)', extraField.status === 400);

const login = await req('POST', '/api/auth/login', {
  email: 'admin@store.local',
  password: 'Admin@1234',
});
check(
  'login สำเร็จ ได้ access+refresh',
  login.status === 200 && login.data?.accessToken && login.data?.refreshToken,
);
const { accessToken, refreshToken } = login.data ?? {};

// --- token ใช้งานได้ ---
const me = await req('GET', '/api/users/me', null, accessToken);
check(
  'GET /users/me ด้วย token → ข้อมูล admin',
  me.status === 200 && me.data?.email === 'admin@store.local',
);

// --- RBAC ---
const adminList = await req('GET', '/api/users', null, accessToken);
check('ADMIN ดูรายชื่อ user ได้', adminList.status === 200);

const whLogin = await req('POST', '/api/auth/login', {
  email: 'warehouse@store.local',
  password: 'Admin@1234',
});
check('warehouse login ได้', whLogin.status === 200);
const whList = await req('GET', '/api/users', null, whLogin.data?.accessToken);
check('WAREHOUSE ขอรายชื่อ user → 403', whList.status === 403);

// --- refresh rotation + reuse detection ---
const r1 = await req('POST', '/api/auth/refresh', { refreshToken });
check(
  'refresh ครั้งแรก → ได้คู่ใหม่',
  r1.status === 200 && r1.data?.refreshToken,
);
const r2 = await req('POST', '/api/auth/refresh', { refreshToken }); // ใช้ตัวเก่าซ้ำ!
check('ใช้ refresh token เดิมซ้ำ → 401 (reuse detected)', r2.status === 401);
const r3 = await req('POST', '/api/auth/refresh', {
  refreshToken: r1.data?.refreshToken,
});
check(
  'token ใหม่ใน family เดียวกันโดน revoke ด้วย → 401',
  r3.status === 401,
);

// --- swagger ---
const swagger = await fetch(BASE + '/api/docs');
check('Swagger UI เปิดได้', swagger.status === 200);

// --- สรุป ---
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
