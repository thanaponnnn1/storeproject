// ออก PDF ป้าย serial สำหรับติดตัวเครื่อง — ใช้ทดสอบ "ยิง serial" ตอนรับของ/จ่ายของ
//
// ในชีวิตจริง serial คือสติกเกอร์ที่โรงงานติดมากับตัวเครื่อง
// ชุดนี้จำลองขึ้นมาเพื่อให้มีอะไรให้ยิงตอนทดสอบ
//
// รัน: node scripts/serial-labels.mjs
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://localhost:3009/api';
const OUT = process.argv.find((a) => a.endsWith('.pdf')) ?? 'serials.pdf';

const FONT =
  ['C:/Windows/Fonts/LeelawUI.ttf', 'C:/Windows/Fonts/tahoma.ttf'].find((f) =>
    existsSync(f),
  ) ?? null;
const FONT_BOLD =
  ['C:/Windows/Fonts/leelawdb.ttf', 'C:/Windows/Fonts/tahomabd.ttf'].find((f) =>
    existsSync(f),
  ) ?? FONT;

/**
 * serial ผูกกับรุ่นสินค้าให้ดูออกว่าเป็นของเครื่องไหน
 * (ระบบไม่บังคับรูปแบบ แต่ตั้งให้อ่านง่ายจะหาของง่ายเวลาเคลม)
 */
const GROUPS = [
  { sku: 'COMP-PUMA-3HP', prefix: 'PUMA26', count: 5 },
  { sku: 'FRZ-SAN-300', prefix: 'SAND26', count: 5 },
];

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@store.local',
      password: 'Admin@1234',
    }),
  }).then((r) => r.json());
  if (!login.accessToken) {
    console.error('เข้าสู่ระบบไม่สำเร็จ — เปิด backend ไว้หรือยัง?');
    process.exit(1);
  }
  const token = login.accessToken;
  const get = (p) =>
    fetch(BASE + p, { headers: { authorization: `Bearer ${token}` } });

  const labels = [];
  for (const g of GROUPS) {
    const found = await get(`/products?search=${g.sku}&limit=1`).then((r) =>
      r.json(),
    );
    const product = found.data?.find((p) => p.sku === g.sku);
    if (!product) {
      console.error(`  ✗ ไม่พบสินค้า ${g.sku} — รัน pnpm demo:receive ก่อน`);
      continue;
    }

    for (let i = 1; i <= g.count; i++) {
      const serial = `${g.prefix}${String(i).padStart(3, '0')}`;
      // serial ที่มีในระบบแล้วจะรับเข้าซ้ำไม่ได้ — เตือนไว้ให้รู้ตัว
      const exists = (await get(`/inventory/serials/${serial}`)).status === 200;
      labels.push({ serial, product, exists });
    }
  }

  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  doc.pipe(createWriteStream(OUT));
  if (FONT) {
    doc.registerFont('th', FONT);
    doc.registerFont('th-bold', FONT_BOLD);
    doc.font('th');
  }

  doc
    .font('th-bold')
    .fontSize(18)
    .text('ป้าย Serial สำหรับทดสอบ', { align: 'center' });
  doc
    .font('th')
    .fontSize(10)
    .fillColor('#555')
    .text(
      'จำลองสติกเกอร์ที่โรงงานติดมากับตัวเครื่อง — ใช้ยิงตอนรับของและตอนจ่ายของ',
      { align: 'center' },
    )
    .moveDown(0.8);

  doc
    .fontSize(9)
    .fillColor('#333')
    .text(
      [
        'วิธีใช้ตอนรับของ:',
        '  1. ยิงบาร์โค้ดสินค้าก่อน (จากไฟล์ barcodes-receive.pdf) → รายการจะขึ้นมา',
        '  2. กดปุ่ม "📷 ยิง serial" ในการ์ดสินค้านั้น',
        '  3. ยิงป้าย serial ข้างล่างนี้ทีละใบ — จำนวนจะวิ่งขึ้นเอง',
        '  4. กดปุ่ม "ยิง serial" อีกครั้งเพื่อหยุด แล้วยิงสินค้าตัวอื่นต่อได้',
        '',
        'ตอนจ่ายของออก: ยิงป้ายเดิมของเครื่องที่จะส่ง ระบบจะเช็คให้ว่าเครื่องนั้นยังอยู่ในคลังจริง',
      ].join('\n'),
      { lineGap: 2 },
    );

  const COLS = 2;
  const ROWS = 5;
  const W = (595.28 - 56) / COLS;
  const H = (841.89 - 56) / ROWS;

  for (const [i, item] of labels.entries()) {
    if (i % (COLS * ROWS) === 0) doc.addPage();
    const slot = i % (COLS * ROWS);
    const x = 28 + (slot % COLS) * W;
    const y = 28 + Math.floor(slot / COLS) * H;

    doc
      .roundedRect(x + 6, y + 6, W - 12, H - 12, 6)
      .lineWidth(0.8)
      .strokeColor(item.exists ? '#f59e0b' : '#bbb')
      .stroke();

    // Code128 รองรับตัวอักษร+ตัวเลข (serial ไม่ใช่ตัวเลขล้วนเหมือน EAN)
    const img = await bwipjs.toBuffer({
      bcid: 'code128',
      text: item.serial,
      scale: 3,
      height: 16,
      includetext: true,
      textxalign: 'center',
      textsize: 10,
      paddingwidth: 2,
      paddingheight: 2,
    });

    const imgW = 190;
    doc.image(img, x + (W - imgW) / 2, y + 20, { width: imgW });

    doc
      .font('th-bold')
      .fontSize(11)
      .fillColor('#000')
      .text(item.product.name, x + 12, y + 92, {
        width: W - 24,
        align: 'center',
        height: 26,
        ellipsis: true,
      });
    doc
      .font('th')
      .fontSize(9)
      .fillColor('#666')
      .text(
        `${item.product.sku} · ประกัน ${item.product.warrantyMonths} เดือน`,
        x + 12,
        doc.y,
        { width: W - 24, align: 'center' },
      );

    if (item.exists) {
      doc
        .fontSize(8)
        .fillColor('#b45309')
        .text('⚠️ serial นี้มีในระบบแล้ว (รับเข้าซ้ำไม่ได้)', x + 12, doc.y + 2, {
          width: W - 24,
          align: 'center',
        });
    }
  }

  doc.end();

  const usable = labels.filter((l) => !l.exists).length;
  console.log(
    `\nออกไฟล์แล้ว: ${join(process.cwd(), OUT)}\n` +
      `  ป้าย serial ${labels.length} ใบ · พร้อมใช้ ${usable} ใบ` +
      (usable < labels.length
        ? ` (อีก ${labels.length - usable} ใบเคยรับเข้าไปแล้ว)`
        : ''),
  );
  for (const g of GROUPS) {
    const mine = labels.filter((l) => l.product.sku === g.sku);
    if (mine.length) {
      console.log(
        `  ${g.sku.padEnd(16)} ${mine.map((m) => m.serial).join(', ')}`,
      );
    }
  }
}

await main();
