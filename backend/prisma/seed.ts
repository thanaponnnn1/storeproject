import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ROLES = [
  { name: 'ADMIN', description: 'ดูแลระบบทั้งหมด' },
  { name: 'MANAGER', description: 'อนุมัติเอกสาร ดูรายงาน' },
  { name: 'WAREHOUSE', description: 'รับเข้า/จ่ายออก/ปรับยอดสต๊อก' },
  { name: 'SALES', description: 'เปิดใบเสนอราคา/ใบสั่งขาย' },
];

const PERMISSIONS = [
  { code: 'user.manage', description: 'จัดการผู้ใช้' },
  { code: 'master.manage', description: 'จัดการ master data' },
  { code: 'stock.receive', description: 'รับสินค้าเข้า' },
  { code: 'stock.issue', description: 'จ่ายสินค้าออก' },
  { code: 'stock.adjust', description: 'ปรับยอดสต๊อก' },
  { code: 'doc.create', description: 'สร้างเอกสาร' },
  { code: 'doc.approve', description: 'อนุมัติเอกสาร' },
  { code: 'doc.cancel', description: 'ยกเลิกเอกสาร' },
  { code: 'report.view', description: 'ดูรายงาน' },
];

async function main(): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: { description: perm.description },
      create: perm,
    });
  }

  // ADMIN ได้ทุก permission
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'ADMIN' },
  });
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@store.local';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('ต้องตั้ง SEED_ADMIN_PASSWORD ใน .env ก่อน seed');
  }

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'System Admin',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      roleId: adminRole.id,
    },
  });

  // user แต่ละหน้าที่สำหรับ dev/ทดสอบสิทธิ์ (รหัสเดียวกับ admin — dev เท่านั้น)
  for (const staff of [
    { email: 'warehouse@store.local', name: 'Warehouse Staff', role: 'WAREHOUSE' },
    { email: 'sales@store.local', name: 'Sales Staff', role: 'SALES' },
    { email: 'manager@store.local', name: 'Store Manager', role: 'MANAGER' },
  ]) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: staff.role },
    });
    await prisma.user.upsert({
      where: { email: staff.email },
      update: {},
      create: {
        email: staff.email,
        name: staff.name,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        roleId: role.id,
      },
    });
  }

  await seedMasterData();

  console.log(`Seed เสร็จ: admin = ${email}, warehouse = warehouse@store.local`);
}

// ---------- Master Data: ของจริงหน้าร้านเครื่องใช้ไฟฟ้า/ช่าง/ก่อสร้าง ----------

const UOMS = [
  { code: 'PCS', name: 'ชิ้น' },
  { code: 'EA', name: 'เครื่อง' },
  { code: 'BAR', name: 'เส้น' },
  { code: 'BUNDLE', name: 'มัด' },
  { code: 'M', name: 'เมตร' },
  { code: 'ROLL', name: 'ม้วน' },
  { code: 'BAG', name: 'ถุง' },
  { code: 'CAN', name: 'กระป๋อง' },
  { code: 'BOX', name: 'ลัง' },
];

const CATEGORIES = ['เครื่องใช้ไฟฟ้า', 'อุปกรณ์ช่าง', 'วัสดุก่อสร้าง'];

async function seedMasterData(): Promise<void> {
  for (const uom of UOMS) {
    await prisma.uom.upsert({
      where: { code: uom.code },
      update: { name: uom.name },
      create: uom,
    });
  }
  const uom = async (code: string) =>
    (await prisma.uom.findUniqueOrThrow({ where: { code } })).id;

  for (const name of CATEGORIES) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }
  const cat = async (name: string) =>
    (await prisma.category.findUniqueOrThrow({ where: { name } })).id;

  await prisma.warehouse.upsert({
    where: { code: 'WH-MAIN' },
    update: {},
    create: { code: 'WH-MAIN', name: 'คลังหลัก' },
  });

  type SeedProduct = {
    sku: string;
    name: string;
    brand?: string;
    model?: string;
    category: string;
    baseUom: string;
    trackingType?: 'NONE' | 'SERIAL' | 'LOT';
    costingMethod?: 'AVG' | 'FIFO';
    warrantyMonths?: number;
    prices: [number, number, number]; // [ปลีก, ช่าง, โครงการ] ต่อหน่วยฐาน
    minStock?: number;
    units?: { uom: string; factor: number; salePrice?: number }[];
    barcodes?: { code?: string; uom?: string }[]; // code ว่าง = internal QR
  };

  const products: SeedProduct[] = [
    {
      sku: 'AC-DK-12K',
      name: 'แอร์ติดผนัง 12000 BTU',
      brand: 'Daikin',
      model: 'FTKF12XV2S',
      category: 'เครื่องใช้ไฟฟ้า',
      baseUom: 'EA',
      trackingType: 'SERIAL',
      warrantyMonths: 12,
      prices: [14900, 14200, 13500],
      barcodes: [{ code: '8850000000011' }],
    },
    {
      sku: 'RF-SS-2D',
      name: 'ตู้เย็น 2 ประตู 12.8 คิว',
      brand: 'Samsung',
      model: 'RT35',
      category: 'เครื่องใช้ไฟฟ้า',
      baseUom: 'EA',
      trackingType: 'SERIAL',
      warrantyMonths: 24,
      prices: [12990, 12400, 11800],
      barcodes: [{ code: '8850000000028' }],
    },
    {
      sku: 'PUMP-MT-155',
      name: 'ปั๊มน้ำอัตโนมัติ 155W',
      brand: 'Mitsubishi',
      model: 'WP-155R',
      category: 'เครื่องใช้ไฟฟ้า',
      baseUom: 'EA',
      trackingType: 'SERIAL',
      warrantyMonths: 12,
      prices: [4590, 4300, 4100],
      barcodes: [{ code: '8850000000035' }],
    },
    {
      sku: 'DRL-MK-13',
      name: 'สว่านไฟฟ้า 13 มม.',
      brand: 'Makita',
      model: 'HP1630',
      category: 'อุปกรณ์ช่าง',
      baseUom: 'PCS',
      warrantyMonths: 6,
      prices: [2290, 2100, 1990],
      barcodes: [{ code: '8850000000042' }],
    },
    {
      sku: 'CEM-TPI-M199',
      name: 'ปูนซีเมนต์ผสม 50 กก.',
      brand: 'TPI',
      model: 'M199',
      category: 'วัสดุก่อสร้าง',
      baseUom: 'BAG',
      trackingType: 'LOT',
      costingMethod: 'FIFO',
      prices: [135, 125, 118],
      minStock: 50,
      barcodes: [{ code: undefined }], // internal QR — ปูนไม่มี barcode รายถุง
    },
    {
      sku: 'PAINT-TOA-WH1',
      name: 'สีน้ำอะคริลิกทาภายใน ขาว 9 ลิตร',
      brand: 'TOA',
      category: 'วัสดุก่อสร้าง',
      baseUom: 'CAN',
      trackingType: 'LOT',
      costingMethod: 'FIFO',
      prices: [890, 820, 780],
      barcodes: [{ code: '8850000000059' }],
    },
    {
      sku: 'STL-RB9',
      name: 'เหล็กเส้นกลม RB9 SR24 ยาว 10 ม.',
      category: 'วัสดุก่อสร้าง',
      baseUom: 'BAR',
      costingMethod: 'FIFO',
      prices: [58, 54, 51],
      minStock: 100,
      units: [{ uom: 'BUNDLE', factor: 10, salePrice: 520 }],
      barcodes: [{ code: undefined }, { code: undefined, uom: 'BUNDLE' }],
    },
    {
      sku: 'WIR-THW-1x1.5',
      name: 'สายไฟ THW 1x1.5 ตร.มม.',
      brand: 'Thai Yazaki',
      category: 'วัสดุก่อสร้าง',
      baseUom: 'M',
      costingMethod: 'FIFO',
      prices: [9, 8, 7.5],
      units: [{ uom: 'ROLL', factor: 100, salePrice: 750 }],
      barcodes: [{ code: '8850000000066', uom: 'ROLL' }, { code: undefined }],
    },
    {
      sku: 'PVC-SCG-2',
      name: 'ท่อ PVC 2 นิ้ว ชั้น 8.5 ยาว 4 ม.',
      brand: 'SCG',
      category: 'วัสดุก่อสร้าง',
      baseUom: 'BAR',
      prices: [138, 128, 120],
      barcodes: [{ code: undefined }],
    },
  ];

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        model: p.model,
        categoryId: await cat(p.category),
        baseUomId: await uom(p.baseUom),
        trackingType: p.trackingType ?? 'NONE',
        costingMethod: p.costingMethod ?? 'AVG',
        warrantyMonths: p.warrantyMonths ?? 0,
        priceRetail: p.prices[0],
        priceContractor: p.prices[1],
        priceProject: p.prices[2],
        minStock: p.minStock ?? 0,
      },
    });

    for (const u of p.units ?? []) {
      await prisma.productUnit.upsert({
        where: {
          productId_uomId: { productId: product.id, uomId: await uom(u.uom) },
        },
        update: { conversionFactor: u.factor, salePrice: u.salePrice },
        create: {
          productId: product.id,
          uomId: await uom(u.uom),
          conversionFactor: u.factor,
          salePrice: u.salePrice,
        },
      });
    }

    for (const b of p.barcodes ?? []) {
      const unitId = b.uom
        ? (
            await prisma.productUnit.findUniqueOrThrow({
              where: {
                productId_uomId: {
                  productId: product.id,
                  uomId: await uom(b.uom),
                },
              },
            })
          ).id
        : null;
      const uomCode = b.uom ?? p.baseUom;
      const barcode = b.code ?? `INT:${p.sku}:${uomCode}`;
      await prisma.productBarcode.upsert({
        where: { barcode },
        update: {},
        create: {
          productId: product.id,
          productUnitId: unitId,
          barcode,
          isInternal: !b.code,
        },
      });
    }
  }

  const partners = [
    {
      code: 'C-0001',
      name: 'ลูกค้าหน้าร้าน (เงินสด)',
      type: 'CUSTOMER',
      priceLevel: 'RETAIL',
      creditTermDays: 0,
    },
    {
      code: 'C-0002',
      name: 'ช่างสมชาย รับเหมาไฟฟ้า',
      type: 'CUSTOMER',
      priceLevel: 'CONTRACTOR',
      creditTermDays: 15,
      phone: '0812345678',
    },
    {
      code: 'C-0003',
      name: 'บจก.พฤกษาก่อสร้าง (โครงการ)',
      type: 'CUSTOMER',
      priceLevel: 'PROJECT',
      creditTermDays: 30,
      taxId: '0105500000001',
    },
    {
      code: 'S-0001',
      name: 'บจก.สยามอิเล็คทริคซัพพลาย',
      type: 'SUPPLIER',
      creditTermDays: 30,
      taxId: '0105500000002',
    },
  ] as const;

  for (const pt of partners) {
    await prisma.partner.upsert({
      where: { code: pt.code },
      update: {},
      create: pt,
    });
  }

  // ล็อตตัวอย่างของสินค้า LOT (ปูน/สี) — ให้เห็นการเรียงแบบ FEFO ทันทีหลัง seed
  const day = 86_400_000;
  const sampleLots: { sku: string; lotNo: string; expiryInDays: number }[] = [
    { sku: 'CEM-TPI-M199', lotNo: 'TPI-2026-07', expiryInDays: 25 },
    { sku: 'CEM-TPI-M199', lotNo: 'TPI-2026-08', expiryInDays: 80 },
    { sku: 'PAINT-TOA-WH1', lotNo: 'TOA-2026-06', expiryInDays: 300 },
  ];
  for (const lot of sampleLots) {
    const product = await prisma.product.findUnique({
      where: { sku: lot.sku },
      select: { id: true },
    });
    if (!product) continue;
    await prisma.lot.upsert({
      where: { productId_lotNo: { productId: product.id, lotNo: lot.lotNo } },
      update: {},
      create: {
        productId: product.id,
        lotNo: lot.lotNo,
        expiryDate: new Date(Date.now() + lot.expiryInDays * day),
        receivedAt: new Date(),
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
