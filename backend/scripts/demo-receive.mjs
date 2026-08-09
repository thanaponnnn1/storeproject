// สินค้าชุดที่ 2 สำหรับทดสอบ "รับของเข้าคลัง" โดยเฉพาะ
//
// ต่างจากชุดแรกตรงที่ **ไม่รับสต๊อกเข้าให้** — ปล่อยว่างไว้ให้ทดลองยิงรับเองจากหน้าเว็บ
// และสร้างใบสั่งซื้อที่อนุมัติแล้วรอไว้ 1 ใบ เพื่อทดสอบโหมด "รับตามใบสั่งซื้อ"
//
// รัน: node scripts/demo-receive.mjs
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

/** เลขตรวจสอบ EAN-13 — คำนวณผิดเครื่องสแกนจะไม่ยอมอ่าน */
function ean13(prefix12) {
  const d = prefix12.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = d.reduce((s, n, i) => s + n * (i % 2 === 0 ? 1 : 3), 0);
  return prefix12 + String((10 - (sum % 10)) % 10);
}
let seq = 0;
// ใช้ช่วงเลข 3xxxxxx แยกจากชุดแรก (2xxxxxx) ไม่ให้ชนกัน
const nextEan = () =>
  ean13('885' + String(3000000 + ++seq).padStart(9, '0'));

const PRODUCTS = [
  // ===== ตามเครื่อง (ต้องยิง serial ตอนรับ) =====
  { sku: 'COMP-PUMA-3HP', name: 'ปั๊มลม 3 แรงม้า 148 ลิตร', brand: 'PUMA', model: 'PP-3', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 12, price: [12900, 12200, 11600] },
  { sku: 'FRZ-SAN-300', name: 'ตู้แช่แข็ง 300 ลิตร', brand: 'Sanden', model: 'SNH-0305', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', track: 'SERIAL', warranty: 24, price: [15900, 15200, 14500] },

  // ===== ตามล็อต (ต้องกรอกเลขล็อต+วันหมดอายุตอนรับ) =====
  { sku: 'ADH-JAG-25', name: 'กาวซีเมนต์ปูกระเบื้อง 25 กก.', brand: 'จระเข้', cat: 'วัสดุก่อสร้าง', uom: 'BAG', track: 'LOT', costing: 'FIFO', price: [285, 265, 250], min: 40, internal: true },
  { sku: 'PNT-BGR-OIL5', name: 'สีน้ำมันเคลือบเงา 5 ลิตร', brand: 'Beger', cat: 'วัสดุก่อสร้าง', uom: 'CAN', track: 'LOT', costing: 'FIFO', price: [1150, 1080, 1020] },

  // ===== หลายหน่วยนับ (ทดสอบยิงหน่วยมัด/ม้วนแล้วแปลงหน่วย) =====
  { sku: 'PPR-SCG-20', name: 'ท่อ PPR 20 มม. ยาว 4 ม.', brand: 'SCG', cat: 'วัสดุก่อสร้าง', uom: 'BAR', costing: 'FIFO', price: [95, 88, 83], min: 50, unit: { code: 'BUNDLE', factor: 10, price: 880 }, internal: true },
  { sku: 'WIR-VAF-2x15', name: 'สายไฟ VAF 2x1.5 ตร.มม.', brand: 'Thai Yazaki', cat: 'วัสดุก่อสร้าง', uom: 'M', costing: 'FIFO', price: [21, 19.5, 18.5], unit: { code: 'ROLL', factor: 100, price: 1850 } },

  // ===== นับจำนวนธรรมดา =====
  { sku: 'SAW-MAK-7', name: 'เลื่อยวงเดือน 7 นิ้ว', brand: 'Makita', model: 'M5802B', cat: 'อุปกรณ์ช่าง', uom: 'PCS', warranty: 6, price: [2790, 2650, 2500] },
  { sku: 'STOVE-LUC-2', name: 'เตาแก๊ส 2 หัว หน้ากระจก', brand: 'Lucky Flame', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', warranty: 12, price: [2490, 2350, 2250] },
  { sku: 'RC-SHP-18', name: 'หม้อหุงข้าวไฟฟ้า 1.8 ลิตร', brand: 'Sharp', model: 'KSH-D19', cat: 'เครื่องใช้ไฟฟ้า', uom: 'EA', warranty: 12, price: [1290, 1220, 1150] },
  { sku: 'TILE-COT-60', name: 'กระเบื้องปูพื้น 60×60 ซม. (4 แผ่น/ลัง)', brand: 'Cotto', cat: 'วัสดุก่อสร้าง', uom: 'BOX', costing: 'FIFO', price: [420, 395, 375], min: 30 },
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
  const supplier = (
    await req('GET', '/partners?type=SUPPLIER&limit=10', null, token)
  ).data.data[0];

  const uomId = (code) => uoms.find((u) => u.code === code)?.id;
  const catId = (name) => cats.find((c) => c.name === name)?.id;

  const created = [];
  console.log('สินค้าชุดทดสอบรับของ (ยังไม่มีของในคลัง)\n');

  for (const p of PRODUCTS) {
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

    if (full.barcodes.length === 0) {
      await req(
        'POST',
        `/products/${product.id}/barcodes`,
        p.internal ? {} : { barcode: nextEan() },
        token,
      );
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

    const final = (await req('GET', `/products/${product.id}`, null, token))
      .data;
    created.push({ product: final, spec: p });

    const kind =
      p.track === 'SERIAL'
        ? 'ยิง serial'
        : p.track === 'LOT'
          ? 'กรอกล็อต'
          : p.unit
            ? 'หลายหน่วย'
            : 'ธรรมดา';
    console.log(
      `  ✓ ${p.sku.padEnd(16)} ${kind.padEnd(10)} ${final.barcodes.map((b) => b.barcode).join(' , ')}`,
    );
  }

  // ---- ใบสั่งซื้อรออยู่ 1 ใบ สำหรับทดสอบโหมด "รับตามใบสั่งซื้อ" ----
  const poLines = created
    .filter((c) =>
      ['SAW-MAK-7', 'RC-SHP-18', 'TILE-COT-60'].includes(c.product.sku),
    )
    .map((c) => ({
      productId: c.product.id,
      qty: c.product.sku === 'TILE-COT-60' ? 50 : 10,
      unitCost: Math.round(Number(c.product.priceRetail) * 0.75),
    }));

  const existingPo = (
    await req('GET', '/purchase-orders?status=APPROVED&limit=50', null, token)
  ).data.data.find((p) => p.docNo.startsWith('PO-'));

  const po = await req(
    'POST',
    '/purchase-orders',
    {
      partnerId: supplier.id,
      warehouseId: warehouse.id,
      remark: 'ใบสั่งซื้อตัวอย่างสำหรับทดสอบการรับของ',
      lines: poLines,
    },
    token,
  );
  if (po.status === 201) {
    await req(
      'PATCH',
      `/purchase-orders/${po.data.id}/approve`,
      null,
      token,
    );
    console.log(
      `\n  ✓ สร้างใบสั่งซื้อรอรับของ: ${po.data.docNo} (${supplier.name})`,
    );
    for (const l of po.data.lines) {
      const c = created.find((x) => x.product.id === l.productId);
      console.log(
        `      · ${c?.product.name} × ${Number(l.qty)} ${c?.product.baseUom?.name} @ ฿${Number(l.unitCost)}`,
      );
    }
  } else {
    console.error(`\n  ✗ สร้างใบสั่งซื้อไม่สำเร็จ: ${po.data?.message}`);
  }
  void existingPo;

  writeFileSync(
    join(import.meta.dirname, 'demo-receive-skus.json'),
    JSON.stringify(
      created.map((c) => c.product.sku),
      null,
      2,
    ),
  );

  console.log(`\nเสร็จ: สินค้าใหม่ ${created.length} รายการ (ยอดคงเหลือ 0 ทุกตัว)`);
  console.log(
    'ทำ PDF บาร์โค้ด: node scripts/barcode-pdf.mjs barcodes-receive.pdf --skus=scripts/demo-receive-skus.json',
  );
}

await main();
