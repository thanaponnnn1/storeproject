// สร้างสินค้าตัวอย่าง 20 รายการพร้อมบาร์โค้ดและสต๊อก สำหรับทดสอบการสแกน
//
// ยิงผ่าน REST API ไม่ใช่เขียน DB ตรง ๆ เพื่อให้ผ่านกฎธุรกิจทุกข้อ
// (ต้นทุน FIFO/เฉลี่ย, cost layer, serial, lot) ข้อมูลจึงตรงกับ ledger เสมอ
//
// รัน: node scripts/demo-products.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.API_BASE ?? 'http://localhost:3009/api';

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

/**
 * เลขตรวจสอบของ EAN-13 — ถ้าคำนวณผิด เครื่องสแกนของจริงจะไม่ยอมอ่าน
 * ตำแหน่งคี่คูณ 1 ตำแหน่งคู่คูณ 3 รวมแล้วเติมให้ครบสิบ
 */
function ean13(prefix12) {
  const digits = prefix12.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  return prefix12 + String((10 - (sum % 10)) % 10);
}

// 885 = รหัสประเทศไทยของ GS1 · 4 หลักถัดไปสมมติเป็นรหัสผู้ผลิต
let barcodeSeq = 0;
const nextEan = () => ean13('885' + String(2000000 + ++barcodeSeq).padStart(9, '0'));

/**
 * 20 รายการครอบคลุมสินค้าทั้ง 3 กลุ่มของร้าน
 * unit: หน่วยขายเพิ่ม (มัด/ม้วน) · serialCount/lot: วิธีติดตาม · stock: จำนวนที่รับเข้า
 */
const PRODUCTS = [
  // ===== เครื่องใช้ไฟฟ้า (ตามเครื่อง มีประกัน) =====
  { sku: 'AC-DKN-12K', name: 'แอร์ติดผนัง 12,000 BTU', brand: 'Daikin', model: 'FTKF12XV2S', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 12, price: [14900, 14200, 13500], stock: 4, cost: 12000 },
  { sku: 'AC-MIT-18K', name: 'แอร์ติดผนัง 18,000 BTU', brand: 'Mitsubishi', model: 'MS-GN18VF', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 12, price: [21900, 20900, 19900], stock: 3, cost: 17500 },
  { sku: 'RF-SAM-2D', name: 'ตู้เย็น 2 ประตู 12.8 คิว', brand: 'Samsung', model: 'RT35K5534', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 24, price: [12990, 12400, 11800], stock: 3, cost: 10500 },
  { sku: 'WM-LG-12KG', name: 'เครื่องซักผ้าฝาบน 12 กก.', brand: 'LG', model: 'T2312VS', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 24, price: [8990, 8500, 8100], stock: 2, cost: 7200 },
  { sku: 'PUMP-MIT-155', name: 'ปั๊มน้ำอัตโนมัติ 155 วัตต์', brand: 'Mitsubishi', model: 'WP-155R', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 12, price: [4590, 4300, 4100], stock: 5, cost: 3600 },
  { sku: 'WH-PAN-4500', name: 'เครื่องทำน้ำอุ่น 4,500 วัตต์', brand: 'Panasonic', model: 'DH-4RL1', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 12, price: [3290, 3100, 2950], stock: 6, cost: 2500 },
  { sku: 'FAN-HAT-16', name: 'พัดลมตั้งพื้น 16 นิ้ว', brand: 'Hatari', model: 'HF-S18M1', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', price: [1290, 1200, 1150], stock: 15, cost: 950 },

  // ===== อุปกรณ์ช่าง =====
  { sku: 'DRL-MAK-13', name: 'สว่านไฟฟ้า 13 มม.', brand: 'Makita', model: 'HP1630', cat: 'อุปกรณ์ช่าง', uom: 'PCS', warranty: 6, price: [2290, 2100, 1990], stock: 8, cost: 1750 },
  { sku: 'DRL-BOS-ROT', name: 'สว่านโรตารี่ 3 ระบบ 26 มม.', brand: 'Bosch', model: 'GBH 2-26', cat: 'อุปกรณ์ช่าง', uom: 'PCS', track: 'SERIAL', warranty: 12, price: [6900, 6500, 6200], stock: 3, cost: 5400 },
  { sku: 'GRD-MAK-4', name: 'เครื่องเจียร 4 นิ้ว', brand: 'Makita', model: 'M0900B', cat: 'อุปกรณ์ช่าง', uom: 'PCS', warranty: 6, price: [1450, 1350, 1290], stock: 10, cost: 1050 },
  { sku: 'TAPE-STL-5M', name: 'ตลับเมตร 5 เมตร', brand: 'Stanley', cat: 'อุปกรณ์ช่าง', uom: 'PCS', price: [165, 150, 140], stock: 40, cost: 105 },
  { sku: 'WRN-ADJ-10', name: 'ประแจเลื่อน 10 นิ้ว', brand: 'Solo', cat: 'อุปกรณ์ช่าง', uom: 'PCS', price: [320, 295, 280], stock: 25, cost: 210 },
  { sku: 'LDR-ALU-6', name: 'บันไดอลูมิเนียม 6 ขั้น', brand: 'Sanki', cat: 'อุปกรณ์ช่าง', uom: 'PCS', price: [1890, 1750, 1650], stock: 7, cost: 1400 },
  { sku: 'SCR-SET-32', name: 'ชุดไขควง 32 ชิ้น', brand: 'Bosch', cat: 'อุปกรณ์ช่าง', uom: 'PCS', price: [590, 550, 520], stock: 18, cost: 400 },

  // ===== วัสดุก่อสร้าง =====
  { sku: 'CEM-TPI-M199', name: 'ปูนซีเมนต์ผสม 50 กก.', brand: 'TPI', model: 'M199', cat: 'วัสดุก่อสร้าง', uom: 'BAG', track: 'LOT', costing: 'FIFO', price: [135, 125, 118], min: 100, stock: 300, cost: 108, internal: true },
  { sku: 'CEM-SCG-PLS', name: 'ปูนฉาบสำเร็จรูป 50 กก.', brand: 'SCG', cat: 'วัสดุก่อสร้าง', uom: 'BAG', track: 'LOT', costing: 'FIFO', price: [148, 138, 130], min: 80, stock: 200, cost: 118, internal: true },
  { sku: 'PNT-TOA-WH9', name: 'สีน้ำอะคริลิกทาภายใน ขาว 9 ลิตร', brand: 'TOA', cat: 'วัสดุก่อสร้าง', uom: 'CAN', track: 'LOT', costing: 'FIFO', price: [890, 820, 780], stock: 24, cost: 690 },
  { sku: 'STL-RB9-10M', name: 'เหล็กเส้นกลม RB9 ยาว 10 ม.', cat: 'วัสดุก่อสร้าง', uom: 'BAR', costing: 'FIFO', price: [58, 54, 51], min: 200, stock: 500, cost: 45, unit: { code: 'BUNDLE', factor: 10, price: 520 }, internal: true },
  { sku: 'STL-DB12-10M', name: 'เหล็กข้ออ้อย DB12 ยาว 10 ม.', cat: 'วัสดุก่อสร้าง', uom: 'BAR', costing: 'FIFO', price: [178, 168, 160], min: 100, stock: 300, cost: 142, unit: { code: 'BUNDLE', factor: 10, price: 1650 }, internal: true },
  { sku: 'WIR-THW-25', name: 'สายไฟ THW 1x2.5 ตร.มม.', brand: 'Thai Yazaki', cat: 'วัสดุก่อสร้าง', uom: 'M', costing: 'FIFO', price: [14, 13, 12.5], stock: 1000, cost: 10.5, unit: { code: 'ROLL', factor: 100, price: 1250 } },
];

async function main() {
  const login = await req('POST', '/auth/login', {
    email: 'admin@store.local',
    password: 'Admin@1234',
  });
  if (login.status !== 200) {
    console.error('เข้าสู่ระบบไม่สำเร็จ — เปิด backend ไว้หรือยัง?');
    process.exit(1);
  }
  const token = login.data.accessToken;

  const uoms = (await req('GET', '/uoms', null, token)).data;
  const cats = (await req('GET', '/categories', null, token)).data;
  const warehouse = (await req('GET', '/warehouses', null, token)).data.find(
    (w) => w.code === 'WH-MAIN',
  );
  const uomId = (code) => uoms.find((u) => u.code === code)?.id;
  const catId = (name) => cats.find((c) => c.name === name)?.id;

  const stamp = Date.now().toString().slice(-6);
  const created = [];

  for (const p of PRODUCTS) {
    // สินค้ามีอยู่แล้วก็ใช้ตัวเดิม (รันสคริปต์ซ้ำได้ไม่พัง)
    const existing = (
      await req('GET', `/products?search=${p.sku}&limit=1`, null, token)
    ).data.data.find((x) => x.sku === p.sku);

    let product = existing;
    if (!product) {
      const res = await req(
        'POST',
        '/products',
        {
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          model: p.model,
          categoryId: catId(p.cat),
          baseUomId: uomId(p.uom),
          trackingType: p.track ?? 'NONE',
          costingMethod: p.costing ?? 'AVG',
          warrantyMonths: p.warranty ?? 0,
          priceRetail: p.price[0],
          priceContractor: p.price[1],
          priceProject: p.price[2],
          minStock: p.min ?? 0,
          units: p.unit
            ? [
                {
                  uomId: uomId(p.unit.code),
                  conversionFactor: p.unit.factor,
                  salePrice: p.unit.price,
                },
              ]
            : undefined,
        },
        token,
      );
      if (res.status !== 201) {
        console.error(`  ✗ ${p.sku}: ${res.data?.message}`);
        continue;
      }
      product = res.data;
    }

    const full = (await req('GET', `/products/${product.id}`, null, token)).data;

    // ---- บาร์โค้ด ----
    if (full.barcodes.length === 0) {
      if (p.internal) {
        // ของขายเป็นกอง ไม่มีบาร์โค้ดโรงงาน → ใช้ QR ที่ร้านพิมพ์เอง
        await req('POST', `/products/${product.id}/barcodes`, {}, token);
      } else {
        await req(
          'POST',
          `/products/${product.id}/barcodes`,
          { barcode: nextEan() },
          token,
        );
      }
      // หน่วยขายใหญ่ (มัด/ม้วน) มีบาร์โค้ดของตัวเอง
      if (p.unit) {
        const unit = full.units.find((u) => u.uom.code === p.unit.code);
        if (unit) {
          await req(
            'POST',
            `/products/${product.id}/barcodes`,
            p.internal
              ? { productUnitId: unit.id }
              : { barcode: nextEan(), productUnitId: unit.id },
            token,
          );
        }
      }
    }

    // ---- รับสต๊อกเข้า (ผ่าน ledger จริง) ----
    const bal = (
      await req(
        'GET',
        `/inventory/balances?productId=${product.id}`,
        null,
        token,
      )
    ).data.data[0];

    if (!bal || Number(bal.qtyOnHand) === 0) {
      const body = {
        productId: product.id,
        warehouseId: warehouse.id,
        qty: p.stock,
        unitCost: p.cost,
        refDocType: 'MANUAL',
        refDocId: `DEMO-${stamp}`,
        note: 'ตั้งต้นสำหรับทดสอบ',
      };
      if ((p.track ?? 'NONE') === 'SERIAL') {
        // ใช้ SKU เต็มเป็นคำนำหน้า ไม่ใช่แค่คำแรก — ไม่งั้นแอร์สองรุ่นได้ serial ชนกัน
        const prefix = p.sku.replace(/-/g, '');
        body.serials = Array.from(
          { length: p.stock },
          (_, i) => `${prefix}${stamp}${String(i + 1).padStart(3, '0')}`,
        );
      }
      if (p.track === 'LOT') {
        body.lotNo = `LOT-${stamp}`;
        body.expiryDate = new Date(
          Date.now() + 120 * 86_400_000,
        ).toISOString();
      }
      const recv = await req('POST', '/inventory/receipts', body, token);
      if (recv.status !== 201) {
        console.error(`  ✗ รับเข้า ${p.sku}: ${recv.data?.message}`);
      }
    }

    const final = (await req('GET', `/products/${product.id}`, null, token))
      .data;
    created.push(final);
    console.log(
      `  ✓ ${p.sku.padEnd(14)} ${p.name.slice(0, 32).padEnd(34)} ${final.barcodes.map((b) => b.barcode).join(', ')}`,
    );
  }

  // บอกสคริปต์ทำ PDF ว่าต้องพิมพ์ป้ายของสินค้าชุดไหน
  // (ไม่งั้นจะพิมพ์สินค้าที่ชุดทดสอบสร้างทิ้งไว้ปนมาด้วย)
  writeFileSync(
    join(import.meta.dirname, 'demo-skus.json'),
    JSON.stringify(
      created.map((p) => p.sku),
      null,
      2,
    ),
  );

  console.log(`\nเสร็จ: สินค้า ${created.length} รายการ`);
  console.log('ทำ PDF บาร์โค้ดต่อด้วย: node scripts/barcode-pdf.mjs');
}

await main();
