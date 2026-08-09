// ออกไฟล์ PDF ป้ายบาร์โค้ดของสินค้าทุกรายการ สำหรับพิมพ์ไปทดสอบยิงด้วยมือถือ
//
// รัน: node scripts/barcode-pdf.mjs [ชื่อไฟล์]
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://localhost:3009/api';
const OUT = process.argv.find((a) => a.endsWith('.pdf')) ?? 'barcodes.pdf';
// เลือกได้ว่าจะพิมพ์ป้ายของสินค้าชุดไหน (--skus=scripts/xxx.json)
const SKU_ARG = process.argv.find((a) => a.startsWith('--skus='));
const DEMO_SKUS = SKU_ARG
  ? SKU_ARG.slice('--skus='.length)
  : join(import.meta.dirname, 'demo-skus.json');

/** ฟอนต์ที่อ่านภาษาไทยออก — PDF มาตรฐานไม่มีให้ ต้องฝังเอง */
const THAI_FONTS = [
  'C:/Windows/Fonts/LeelawUI.ttf',
  'C:/Windows/Fonts/leelawad.ttf',
  'C:/Windows/Fonts/tahoma.ttf',
];
const FONT = THAI_FONTS.find((f) => existsSync(f));
const FONT_BOLD =
  ['C:/Windows/Fonts/leelawdb.ttf', 'C:/Windows/Fonts/tahomabd.ttf'].find((f) =>
    existsSync(f),
  ) ?? FONT;

async function req(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return res.json();
}

/** ดึงข้อมูลทีละหน้าจนครบ — API จำกัดหน้าละ 100 แถวเพื่อกันดึงหนักเกินไป */
async function fetchAll(path, token) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await req(`${path}${sep}page=${page}&limit=100`, token);
    out.push(...res.data);
    if (page >= res.meta.totalPages || res.data.length === 0) break;
  }
  return out;
}

/**
 * EAN-13 มีเลขตรวจสอบหลักสุดท้าย ถ้าไม่ตรงเครื่องสแกนจะไม่ยอมอ่าน
 * (ข้อมูลทดสอบเก่าบางตัวเป็นเลข 13 หลักที่ไม่ใช่ EAN จริง)
 */
function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const sum = d
    .slice(0, 12)
    .reduce((s, n, i) => s + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

/**
 * เลือกชนิดบาร์โค้ดให้เหมาะกับรหัส:
 *  - EAN-13 ที่ถูกต้อง → แท่งแบบสินค้าทั่วไป
 *  - รหัสยาว/มีตัวอักษร (QR ของร้าน) → QR
 *  - เลข 13 หลักที่เลขตรวจสอบไม่ถูก → Code128 (ยังยิงได้ ไม่ต้องทิ้งป้าย)
 */
async function barcodeImage(code) {
  const kind = isValidEan13(code)
    ? 'ean13'
    : /^[\x20-\x7E]{1,24}$/.test(code) && !code.includes(':')
      ? 'code128'
      : 'qrcode';

  return bwipjs.toBuffer({
    bcid: kind,
    text: code,
    scale: 3,
    ...(kind === 'qrcode'
      ? { width: 24, height: 24 }
      : { height: 14, includetext: true, textxalign: 'center', textsize: 9 }),
    paddingwidth: 2,
    paddingheight: 2,
  });
}

const money = (v) =>
  Number(v).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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

  // ปกติพิมพ์เฉพาะสินค้าชุดตัวอย่าง (ไม่ปนสินค้าที่ระบบทดสอบสร้างทิ้งไว้)
  // ใส่ --all ถ้าอยากได้ทุกตัวที่มีบาร์โค้ด
  const onlyDemo = !process.argv.includes('--all');
  const demoSkus = existsSync(DEMO_SKUS)
    ? new Set(JSON.parse(readFileSync(DEMO_SKUS, 'utf8')))
    : null;

  const list = await fetchAll('/products', token);
  // เอาเฉพาะที่มีบาร์โค้ด (สินค้าที่ยังไม่ผูกบาร์โค้ดพิมพ์ป้ายไม่ได้)
  const products = [];
  for (const p of list) {
    if (onlyDemo && demoSkus && !demoSkus.has(p.sku)) continue;
    const full = await req(`/products/${p.id}`, token);
    if (full.barcodes?.length) products.push(full);
  }

  const balances = await fetchAll('/inventory/balances', token);
  const stockBySku = new Map(
    balances.map((b) => [b.product.sku, b.qtyOnHand]),
  );

  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  doc.pipe(createWriteStream(OUT));
  if (FONT) {
    doc.registerFont('th', FONT);
    doc.registerFont('th-bold', FONT_BOLD);
    doc.font('th');
  }

  // ---- หน้าปก ----
  doc.font('th-bold').fontSize(20).text('ป้ายบาร์โค้ดสินค้า', { align: 'center' });
  doc
    .font('th')
    .fontSize(11)
    .fillColor('#555')
    .text(
      `ระบบคลังสินค้า · ออกเมื่อ ${new Date().toLocaleString('th-TH')}`,
      { align: 'center' },
    )
    .moveDown(1.5);

  doc.fillColor('#000').fontSize(12).text('วิธีใช้', { underline: true });
  doc
    .fontSize(10)
    .fillColor('#333')
    .text(
      [
        '1. พิมพ์เอกสารนี้ (หรือเปิดค้างไว้บนจอคอมก็ยิงได้)',
        '2. เปิดเว็บบนมือถือ → เมนู "สแกน" → กด "เริ่มสแกน"',
        '3. เล็งบาร์โค้ดให้อยู่ในกรอบ ระบบจะอ่านเองแล้วเด้งข้อมูลสินค้าขึ้นมา',
        '',
        'แท่งขาวดำ = บาร์โค้ด EAN-13 แบบที่โรงงานติดมากับสินค้า',
        'ตารางสี่เหลี่ยม (QR) = ป้ายที่ร้านพิมพ์เอง สำหรับของที่ไม่มีบาร์โค้ดโรงงาน',
        'เช่น เหล็กเส้น ปูน ท่อ — ของพวกนี้ปกติต้องแปะป้ายที่ชั้นวาง',
      ].join('\n'),
      { lineGap: 3 },
    );

  doc.moveDown(1);
  doc.fillColor('#000').fontSize(12).text('สรุปรายการ', { underline: true });
  doc.fontSize(9).fillColor('#333').moveDown(0.3);
  for (const p of products) {
    doc.text(
      `${p.sku.padEnd(16)} ${p.name}   (${p.barcodes.length} ป้าย)`,
      { lineGap: 1 },
    );
  }

  // ---- ป้ายบาร์โค้ด 2 คอลัมน์ × 4 แถวต่อหน้า ----
  const labels = products.flatMap((p) =>
    p.barcodes.map((b) => ({ product: p, barcode: b })),
  );

  const COLS = 2;
  const ROWS = 4;
  const W = (595.28 - 56) / COLS;
  const H = (841.89 - 56) / ROWS;

  for (const [i, item] of labels.entries()) {
    if (i % (COLS * ROWS) === 0) doc.addPage();
    const slot = i % (COLS * ROWS);
    const x = 28 + (slot % COLS) * W;
    const y = 28 + Math.floor(slot / COLS) * H;

    const { product, barcode } = item;
    const unitName =
      barcode.productUnit?.uom?.name ?? product.baseUom?.name ?? '';
    const factor = barcode.productUnit
      ? Number(barcode.productUnit.conversionFactor)
      : 1;

    doc
      .roundedRect(x + 6, y + 6, W - 12, H - 12, 6)
      .lineWidth(0.8)
      .strokeColor('#bbb')
      .stroke();

    const img = await barcodeImage(barcode.barcode);
    const isEan = /^\d{13}$/.test(barcode.barcode);
    const imgW = isEan ? 150 : 105;
    doc.image(img, x + (W - imgW) / 2, y + 18, { width: imgW });

    let textY = y + (isEan ? 100 : 140);
    doc
      .font('th-bold')
      .fontSize(11)
      .fillColor('#000')
      .text(product.name, x + 12, textY, {
        width: W - 24,
        align: 'center',
        height: 30,
        ellipsis: true,
      });

    textY = doc.y + 2;
    doc
      .font('th')
      .fontSize(9)
      .fillColor('#444')
      .text(
        `${product.sku}${product.brand ? ` · ${product.brand}` : ''}`,
        x + 12,
        textY,
        { width: W - 24, align: 'center' },
      );

    doc
      .fontSize(9)
      .fillColor('#000')
      .text(
        `หน่วย ${unitName}${factor !== 1 ? ` (= ${factor} ${product.baseUom?.name})` : ''}  ·  ฿${money(
          barcode.productUnit?.salePrice ?? product.priceRetail,
        )}`,
        x + 12,
        doc.y + 2,
        { width: W - 24, align: 'center' },
      );

    const onHand = stockBySku.get(product.sku);
    doc
      .fontSize(8)
      .fillColor('#666')
      .text(
        `คงเหลือ ${onHand ? Number(onHand).toLocaleString('th-TH') : 0} ${product.baseUom?.name}` +
          (product.trackingType === 'SERIAL'
            ? '  ·  ตามเครื่อง'
            : product.trackingType === 'LOT'
              ? '  ·  ตามล็อต'
              : ''),
        x + 12,
        doc.y + 2,
        { width: W - 24, align: 'center' },
      );

    if (!isEan) {
      doc
        .fontSize(7)
        .fillColor('#999')
        .text(barcode.barcode, x + 12, doc.y + 1, {
          width: W - 24,
          align: 'center',
        });
    }
  }

  doc.end();
  console.log(
    `\nออกไฟล์แล้ว: ${join(process.cwd(), OUT)}\n` +
      `  สินค้า ${products.length} รายการ · ป้ายบาร์โค้ด ${labels.length} ป้าย`,
  );
}

await main();
