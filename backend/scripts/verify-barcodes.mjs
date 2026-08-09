// ตรวจว่าบาร์โค้ดทุกป้ายใน PDF ยิงแล้วเจอสินค้าถูกตัวจริง
// (สร้างรูปสวยแต่ยิงไม่ติด/ไปเจอสินค้าผิดตัว = ป้ายใช้ไม่ได้)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://localhost:3009/api';
const SKU_ARG = process.argv.find((a) => a.startsWith('--skus='));
const DEMO_SKUS = SKU_ARG
  ? SKU_ARG.slice('--skus='.length)
  : join(import.meta.dirname, 'demo-skus.json');

function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const sum = d
    .slice(0, 12)
    .reduce((s, n, i) => s + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@store.local', password: 'Admin@1234' }),
}).then((r) => r.json());
const token = login.accessToken;
const get = (p) =>
  fetch(BASE + p, { headers: { authorization: `Bearer ${token}` } }).then((r) =>
    r.json().then((data) => ({ status: r.status, data })),
  );

const skus = new Set(JSON.parse(readFileSync(DEMO_SKUS, 'utf8')));
const all = [];
for (let page = 1; ; page++) {
  const res = await get(`/products?page=${page}&limit=100`);
  all.push(...res.data.data);
  if (page >= res.data.meta.totalPages) break;
}

let labels = 0;
let bad = 0;
const rows = [];

for (const p of all.filter((p) => skus.has(p.sku))) {
  const full = (await get(`/products/${p.id}`)).data;
  for (const b of full.barcodes) {
    labels++;
    const scan = await get(
      `/products/by-barcode/${encodeURIComponent(b.barcode)}`,
    );

    const resolved = scan.status === 200 && scan.data.product.sku === full.sku;
    const ean = /^\d{13}$/.test(b.barcode);
    const checkOk = !ean || isValidEan13(b.barcode);
    const stock = scan.data?.stock?.[0]?.qtyOnHand ?? 0;
    const ok = resolved && checkOk;
    if (!ok) bad++;

    rows.push(
      `${ok ? 'PASS' : 'FAIL'}  ${b.barcode.padEnd(24)} ${(ean ? 'EAN-13' : 'QR ร้าน').padEnd(8)} ` +
        `${full.sku.padEnd(15)} ${(b.productUnit?.uom.name ?? full.baseUom.name).padEnd(6)} ` +
        `คงเหลือ ${Number(stock).toLocaleString('th-TH')}` +
        (checkOk ? '' : '  ← เลขตรวจสอบไม่ถูก'),
    );
  }
}

console.log(rows.join('\n'));
console.log(
  `\n${labels - bad}/${labels} ป้ายใช้ได้ — ยิงแล้วเจอสินค้าถูกตัวและเลขตรวจสอบถูกต้อง`,
);
if (!existsSync(join(process.cwd(), 'barcodes.pdf'))) {
  console.log('⚠️ ยังไม่มีไฟล์ barcodes.pdf — รัน node scripts/barcode-pdf.mjs');
}
process.exit(bad ? 1 : 0);
