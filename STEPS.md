# STEPS — ลำดับงานทำทีละอย่าง (ติ๊ก ✅ เมื่อเสร็จ)

> กติกา: ทำทีละ step ตามลำดับ ห้ามข้าม แต่ละ step มี "✔ ทดสอบ" บอกว่าจบจริงหรือยัง
> อ่านภาพรวม/เหตุผลการออกแบบได้ที่ [PLAN.md](PLAN.md)

---

## เฟส 0 — Foundation (โครงระบบ + ความปลอดภัยพื้นฐาน)

- [x] **0.1 เตรียมเครื่องมือ**
  ติดตั้ง Node.js LTS (≥20), pnpm, Docker Desktop
  ✔ ทดสอบ: `node -v`, `pnpm -v`, `docker -v` ขึ้นเวอร์ชันครบ

- [x] **0.2 Scaffold NestJS**
  `pnpm dlx @nestjs/cli new backend` (เลือก pnpm) → เปิด strict mode ใน tsconfig
  ✔ ทดสอบ: `pnpm start:dev` แล้วเปิด `http://localhost:3000` ได้ Hello World

- [x] **0.3 Docker Postgres**
  สร้าง `docker-compose.yml` (postgres:16 + volume + healthcheck) ที่ root โปรเจกต์
  ✔ ทดสอบ: `docker compose up -d` แล้วต่อ DB ด้วย `psql`/DBeaver ได้

- [x] **0.4 Config + validate env**
  ติดตั้ง `@nestjs/config` + zod/joi validate `DATABASE_URL`, `JWT_SECRET`, `PORT` — สร้าง `.env` + `.env.example` + ใส่ `.env` ใน `.gitignore`
  ✔ ทดสอบ: ลบ `JWT_SECRET` ออกแล้ว app ต้อง **ไม่ยอม start** พร้อม error ชัดเจน

- [x] **0.5 ติดตั้ง Prisma**
  `pnpm add prisma @prisma/client` → `npx prisma init` → ชี้ `DATABASE_URL` → ทำ `PrismaService` + `PrismaModule` (global)
  ✔ ทดสอบ: `npx prisma migrate dev --name init` ผ่าน (schema เปล่า ๆ ก่อนได้)

- [x] **0.6 Security baseline**
  helmet, `@nestjs/throttler` (เช่น 100 req/นาที), CORS whitelist, global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
  ✔ ทดสอบ: POST body ที่มี field แปลกปลอม → ได้ 400

- [x] **0.7 Swagger**
  `@nestjs/swagger` ที่ `/api/docs` (เปิดเฉพาะ non-production)
  ✔ ทดสอบ: เปิด `/api/docs` เห็นหน้า Swagger UI

- [x] **0.8 ตาราง users + roles**
  Prisma model: `User`, `Role`, `Permission`, `RefreshToken` → migrate → seed admin user (hash ด้วย **argon2**)
  ✔ ทดสอบ: `npx prisma studio` เห็น admin ใน DB (password เป็น hash ไม่ใช่ plaintext)

- [x] **0.9 Auth: login + JWT**
  `POST /auth/login` → ตรวจ argon2 → คืน access token (อายุ 15 นาที) + refresh token — ทำ `JwtAuthGuard` ครอบทุก route เป็น default, เปิด public ด้วย `@Public()`
  ✔ ทดสอบ: ยิง endpoint ไม่มี token → 401, login แล้วใส่ token → 200

- [x] **0.10 Refresh token rotation**
  `POST /auth/refresh` → ออกคู่ใหม่ + revoke ตัวเก่า, ถ้า token เก่าถูกใช้ซ้ำ (reuse) → revoke ทั้ง family
  ✔ ทดสอบ: refresh ด้วย token เดิมซ้ำ 2 รอบ → รอบสองต้อง 401

- [x] **0.11 RBAC**
  `@Roles('ADMIN', 'WAREHOUSE')` + `RolesGuard`
  ✔ ทดสอบ: user role ธรรมดายิง endpoint ของ ADMIN → 403

**🏁 จบเฟส 0: มีระบบ auth ที่ปลอดภัย + โครงพร้อมต่อยอด**

---

## เฟส 1 — Master Data

- [x] **1.1 UoM + Category**
  model + CRUD (`GET/POST/PATCH` — ไม่มี DELETE จริง ใช้ `is_active=false`) — seed หน่วยของร้านจริง: ชิ้น, เส้น, มัด, เมตร, ม้วน, ถุง, ลัง, ตัว
  ✔ ทดสอบ: CRUD ผ่าน Swagger ครบ

- [x] **1.2 Warehouse**
  model + CRUD + seed คลังหลัก 1 คลัง (`WH-MAIN`)
  ✔ ทดสอบ: ดึงรายการคลังได้

- [x] **1.3 Product (หัวใจของ master data)**
  model ตาม PLAN.md: `sku` UNIQUE, `brand`, `model`, `base_uom_id`, **`tracking_type [NONE|SERIAL|LOT]`**, `warranty_months`, **ราคา 3 ระดับ (ปลีก/ช่าง/โครงการ)**, `costing_method` default `AVG` + CRUD + ค้นหา/แบ่งหน้า
  ✔ ทดสอบ: สร้าง "แอร์ Daikin" (SERIAL, ประกัน 12 เดือน), "ปูน TPI" (LOT), "น็อต" (NONE) ได้ครบ, SKU ซ้ำ → 409

- [x] **1.4 หลายหน่วยนับ + ตัวแปลง (product_units)**
  1 มัดเหล็ก = 10 เส้น, 1 ม้วนสายไฟ = 100 เมตร — สต๊อกเก็บ**หน่วยฐาน**เสมอ ราคาขายผูกต่อหน่วยได้
  ✔ ทดสอบ: สร้างเหล็กเส้น (ฐาน=เส้น) + หน่วยมัด×10 → ขอแปลง "2 มัด" ได้ 20 เส้น

- [x] **1.5 Barcode หลายตัวต่อสินค้า (product_barcodes)**
  barcode ผูกกับ (สินค้า + หน่วย) — ชิ้นกับลังคนละ barcode / ของไม่มี barcode โรงงาน → generate QR ภายในจาก SKU + endpoint `GET /products/by-barcode/:code` คืน สินค้า+หน่วย+ตัวคูณ
  ✔ ทดสอบ: ยิง barcode ลัง → ได้หน่วยลัง, ยิง barcode ชิ้น → ได้หน่วยชิ้น, ไม่มีในระบบ → 404 ใน <100ms

- [x] **1.6 Partner (ลูกค้า/ซัพพลายเออร์) + price level**
  model + CRUD + type `CUSTOMER|SUPPLIER|BOTH` + credit_term_days + **price_level [RETAIL|CONTRACTOR|PROJECT]**
  ✔ ทดสอบ: filter `?type=CUSTOMER` ได้เฉพาะลูกค้า, ลูกค้าช่างได้ราคาช่าง

- [x] **1.7 Seed data ชุดทดสอบ (ของจริงหน้าร้าน)**
  แอร์ (SERIAL), ตู้เย็น (SERIAL), ปูน (LOT), สีทาบ้าน (LOT), เหล็กเส้น (multi-unit เส้น/มัด), สายไฟ (เมตร/ม้วน), ท่อ PVC, สว่าน, ปั๊มน้ำ + คู่ค้า 4 ราย (ปลีก/ช่าง/โครงการ/ซัพพลายเออร์)
  ✔ ทดสอบ: `pnpm seed` รันซ้ำได้โดยไม่พังไม่ซ้ำ (upsert)

**🏁 จบเฟส 1: คีย์ master data ครบผ่าน Swagger**

---

## เฟส 2 — Inventory Ledger + ต้นทุน Average ⭐ หัวใจของระบบ

- [x] **2.1 ตาราง ledger**
  model `StockMovement` (append-only, `ref_doc_type`/`ref_doc_id` NOT NULL) + `StockBalance` (cache) + index `(product_id, warehouse_id, created_at)` — **qty เป็น `DECIMAL(18,3)` ทุกที่** (สายไฟ 12.5 เมตรต้องได้) และ movement รับ qty เป็น**หน่วยฐานเสมอ** (คนเรียกแปลงหน่วยก่อน)
  ✔ ทดสอบ: migrate ผ่าน, รับเข้า 12.5 เมตรได้, ยืนยันใน schema ว่าไม่มีทางแก้ movement ผ่าน API

- [x] **2.2 Transaction helper + lock**
  helper รัน Prisma interactive transaction + `SELECT ... FOR UPDATE` บนแถว `StockBalance` (ใช้ `$queryRaw` เฉพาะบรรทัด lock)
  ✔ ทดสอบ: unit test — เปิด 2 transaction ซ้อน แถวถูก lock จริง (ตัวที่สองรอ)

- [x] **2.3 รับเข้า (RECEIVE) + ต้นทุน Average**
  `POST /inventory/receipts` (อ้าง ref doc เสมอ — ช่วงนี้ใช้ doc type `MANUAL` ไปก่อน) → insert movement + คำนวณ avg ใหม่ + update balance ใน tx เดียว
  ✔ ทดสอบ: รับ 10 ชิ้น@100 แล้วรับ 10 ชิ้น@200 → avg ต้อง = 150

- [x] **2.4 จ่ายออก (ISSUE) + กันติดลบ**
  `POST /inventory/issues` → lock → ตรวจยอด → ตัดที่ทุน avg → movement + balance
  ✔ ทดสอบ: มี 5 ชิ้น สั่งจ่าย 6 → 422 พร้อม message ยอดไม่พอ

- [x] **2.5 e2e test กันแย่งสต๊อก (สำคัญมาก)**
  มีของ 10 ชิ้น ยิงจ่าย 7 ชิ้น **2 request พร้อมกัน** (`Promise.all`)
  ✔ ทดสอบ: ต้องสำเร็จแค่ 1 อีกอันโดน reject — ยอดเหลือ 3 ไม่ใช่ -4

- [x] **2.6 ปรับยอด (ADJUST) + กลับรายการ (REVERSAL)**
  `POST /inventory/adjustments` (นับจริงต่างจากระบบ) และ `POST /inventory/movements/:id/reverse`
  ✔ ทดสอบ: reverse แล้วยอดกลับเท่าเดิม และ movement เดิม**ยังอยู่** (ไม่ถูกลบ)

- [x] **2.7 Stock card**
  `GET /inventory/stock-card?productId=&warehouseId=&from=&to=` → รายการ movement + running balance + ทุน ต่อบรรทัด
  ✔ ทดสอบ: ทำรายการ 5 ครั้ง แล้วไล่ยอดสะสมด้วยมือ ตรงกับระบบทุกบรรทัด

- [x] **2.8 Reconcile**
  `GET /inventory/reconcile` เทียบ `StockBalance` cache กับ `SUM(movements)` — รายงานตัวที่ไม่ตรง
  ✔ ทดสอบ: แก้ balance ตรง ๆ ใน DB (จำลองข้อมูลเพี้ยน) → reconcile จับได้

- [x] **2.9 เติมยอดคงเหลือใน barcode lookup**
  endpoint 1.5 คืน `qty_on_hand` ต่อคลังด้วย (แปลงเป็นหน่วยของ barcode ที่ยิงให้ด้วย เช่น ยิง barcode มัด → เห็นทั้ง "12 มัด" และ "120 เส้น")
  ✔ ทดสอบ: ยิง barcode แล้วเห็นยอดคงเหลือถูกต้องทั้งสองหน่วย

**🏁 จบเฟส 2: ได้ ledger pattern จริง + ทุน average + กัน race condition ได้**

---

## เฟส 3 — ต้นทุน FIFO

- [x] **3.1 ตาราง cost layers**
  model `CostLayer` + `CostLayerConsumption` ตาม PLAN.md
  ✔ ทดสอบ: migrate ผ่าน

- [x] **3.2 CostingStrategy interface**
  refactor ของเฟส 2 เป็น `AverageStrategy` + เพิ่ม `FifoStrategy` — เลือกตาม `product.costing_method`
  ✔ ทดสอบ: test เดิมของ average ต้องผ่านเหมือนเดิมทั้งหมด (ไม่ regression)

- [x] **3.3 FIFO รับเข้า**
  RECEIVE ของสินค้า FIFO → สร้าง layer ใหม่ (`remaining_qty = qty`)
  ✔ ทดสอบ: รับ 3 รอบ → มี 3 layers เรียงตามเวลา

- [x] **3.4 FIFO จ่ายออก**
  ISSUE → กิน layer เก่าสุดก่อน อาจคร่อมหลาย layer → บันทึก consumption ทุกก้อน
  ✔ ทดสอบ: รับ 10@100, 10@120, 10@150 → จ่าย 25 → ต้นทุนต้อง = (10×100)+(10×120)+(5×150) = **2,950** และ layer 3 เหลือ 5

- [x] **3.5 FIFO reversal**
  reverse การจ่าย → คืน qty กลับ layer เดิมตาม consumption
  ✔ ทดสอบ: จ่ายแล้ว reverse → layers กลับสภาพเดิมเป๊ะ

- [x] **3.6 Unit test ครอบ costing ทั้งชุด**
  ทุก edge case: จ่ายพอดี layer, คร่อม layer, จ่ายหมดคลัง, รับหลัง reverse
  ✔ ทดสอบ: coverage โมดูล costing = 100%

**🏁 จบเฟส 3: สลับ FIFO/Average รายสินค้าได้ ทุนถูกต้องพิสูจน์ด้วย test**

---

## เฟส 3.5 — Serial & Lot Tracking ⭐ หัวใจของร้านเครื่องใช้ไฟฟ้า/วัสดุก่อสร้าง

- [x] **3.5.1 ตาราง serial_numbers + รับเข้าแบบระบุ serial**
  สินค้า `tracking_type=SERIAL`: รับเข้าต้องแนบ list serial และ**จำนวน serial ต้องเท่ากับ qty เป๊ะ** → สร้าง record สถานะ IN_STOCK ผูก movement
  ✔ ทดสอบ: รับแอร์ 5 เครื่อง + serial 5 ตัว → ผ่าน, ส่ง 4 ตัว → 422, serial ซ้ำในระบบ → 409

- [x] **3.5.2 จ่ายออกแบบเลือก serial**
  จ่ายสินค้า SERIAL ต้องระบุว่าเครื่องไหนออก → สถานะเป็น SOLD + บันทึกลูกค้า + วันขาย + คำนวณ `warranty_end = วันขาย + warranty_months`
  ✔ ทดสอบ: จ่าย serial ที่ไม่มี/ขายไปแล้ว → 422, จ่ายสำเร็จแล้ว warranty_end ถูกต้อง

- [x] **3.5.3 หน้าเช็คประกัน/เคลม**
  `GET /serials/:serial` → สินค้าอะไร ซื้อวันไหน ใครซื้อ ประกันเหลือกี่วัน + ประวัติทั้งหมด (นี่คือ endpoint ที่หน้าร้านใช้บ่อยสุดตอนลูกค้าถือของมาเคลม)
  ✔ ทดสอบ: ยิง serial เครื่องที่ขายแล้ว → เห็นข้อมูลครบใน 1 request

- [x] **3.5.4 ตาราง lots + วันหมดอายุ + FEFO**
  สินค้า `tracking_type=LOT` (ปูน/สี): รับเข้าระบุ lot_no + expiry_date, จ่ายออกต้องระบุ lot และ endpoint แนะนำ **FEFO** (lot ใกล้หมดอายุก่อน)
  ✔ ทดสอบ: มีปูน 2 lot → ระบบแนะนำ lot เก่าก่อน, ยอดคงเหลือแยกราย lot ถูกต้อง

- [x] **3.5.5 Reversal คืน serial/lot**
  กลับรายการจ่าย → serial กลับเป็น IN_STOCK ลบข้อมูลขาย/ประกัน, lot ได้ qty คืน
  ✔ ทดสอบ: จ่ายแล้ว reverse → สภาพกลับเหมือนก่อนจ่ายทุกตาราง

**🏁 จบเฟส 3.5: แอร์ทุกเครื่องตามตัวได้ด้วย serial, ปูนทุกถุงรู้ lot และวันหมดอายุ**

---

## เฟส 4 — Sales Flow (QT → SO → DO → INV → Payment)

- [x] **4.1 Document core**
  `document_counters` + ออกเลขรัน (`QT-2026-08-0001`) ใน tx + FOR UPDATE, ตาราง `ALLOWED_TRANSITIONS`, base service เปลี่ยนสถานะ
  ✔ ทดสอบ: ขอเลข 100 ครั้งพร้อมกัน → ไม่มีเลขซ้ำ/เลขโดด, เปลี่ยนสถานะนอกตาราง → 422

- [x] **4.2 Quotation (QT)**
  header+lines CRUD (แก้ได้เฉพาะ DRAFT), transition DRAFT→SUBMITTED→APPROVED
  ✔ ทดสอบ: แก้ QT ที่ APPROVED แล้ว → 422

- [x] **4.3 SO จาก QT**
  `POST /quotations/:id/convert` → สร้าง SO ที่ line ชี้กลับ `source_line_id` → QT เป็น CONVERTED
  ✔ ทดสอบ: SO line มี reference ถึง QT line ครบทุกบรรทัด

- [x] **4.4 Delivery Order (DO) + post stock**
  สร้าง DO จาก SO (เลือกบางรายการ/บางจำนวนได้) → **CONFIRM = post ISSUE ลง ledger + อัปเดต `qty_delivered` บน SO line ใน tx เดียว** — สินค้า SERIAL ต้องเลือก serial ครบตามจำนวน, สินค้า LOT ต้องระบุ lot (ระบบแนะนำ FEFO) ก่อน confirm ได้
  ✔ ทดสอบ: confirm DO แล้ว stock card มีรายการอ้าง DO เลขที่ถูกต้อง, ของไม่พอ → confirm ไม่ผ่านทั้งใบ, DO แอร์ 2 เครื่องแต่เลือก serial ตัวเดียว → 422

- [x] **4.5 Partial delivery**
  SO 100 ชิ้น → DO ใบแรก 60 → SO เป็น PARTIALLY_DELIVERED → DO ใบสอง 40 → DELIVERED
  ✔ ทดสอบ: ส่งเกินยอดค้าง (DO ใบสอง 50) → 422

- [x] **4.6 ยกเลิก DO = reversal**
  cancel DO ที่ confirm แล้ว → สร้าง reversal movement + คืน `qty_delivered`
  ✔ ทดสอบ: ยอดสต๊อกและยอดค้างส่งกลับมาถูกต้อง

- [x] **4.7 ราคาอัตโนมัติตาม price level**
  ตอนสร้าง QT/SO ระบบดึงราคาตาม price_level ของลูกค้า (ปลีก/ช่าง/โครงการ) และตามหน่วยที่ขาย — แก้ราคาหน้าบิลได้เฉพาะ role ที่มีสิทธิ์ + บันทึก audit
  ✔ ทดสอบ: ลูกค้าช่างเปิด SO → ได้ราคาช่างอัตโนมัติ, user ธรรมดาแก้ราคา → 403

- [x] **4.8 Invoice (INV)**
  สร้างจาก DO (หรือหลาย DO ของ SO เดียวกัน) → ISSUED → track `amount_paid`
  ✔ ทดสอบ: ยอดเงินใน INV ตรงกับ DO ต้นทาง

- [x] **4.9 Payment + ตัดหลายใบ**
  `payments` + `payment_allocations` — เงิน 1 ก้อนตัดหลาย INV, INV ครบ → PAID
  ✔ ทดสอบ: จ่าย 5,000 ตัด INV 3,000 + 2,000 → ทั้งสองใบเป็น PAID, จ่ายเกินหนี้ → 422

- [x] **4.10 e2e เดินเอกสารครบสาย**
  QT → approve → SO → DO(partial 2 ใบ, มีทั้งสินค้า SERIAL และ LOT) → INV → Payment จบใน test เดียว
  ✔ ทดสอบ: จบแล้ว status ทุกใบถูก + stock ถูก + serial เป็น SOLD + ลูกหนี้เป็น 0

**🏁 จบเฟส 4: ได้ document flow + state machine หัวใจ ERP**

---

## เฟส 5 — Purchase Flow (PO → GR)

- [x] **5.1 Purchase Order**
  header+lines + DRAFT→APPROVED + track `qty_received`
  ✔ ทดสอบ: CRUD + transition ถูกต้อง

- [x] **5.2 Goods Receipt + post stock + cost layer**
  สร้าง GR จาก PO → **CONFIRM = post RECEIVE + สร้าง cost layer (FIFO) / คำนวณ avg ใหม่ ใน tx เดียว** — สินค้า SERIAL คีย์/ยิง serial ทุกเครื่องตอนรับ, สินค้า LOT ระบุ lot_no + วันหมดอายุ
  ✔ ทดสอบ: รับของแล้วทุนไหลเข้าถูกวิธีตาม costing_method, รับแอร์โดยไม่คีย์ serial → 422

- [x] **5.3 Partial receive + ยกเลิก GR**
  รับบางส่วน + cancel GR → reversal + คืน layer
  ✔ ทดสอบ: เหมือนเคสฝั่งขายแต่ทิศทางกลับ

- [x] **5.4 e2e ซื้อจนขาย**
  PO → GR (ทุนเข้า) → SO → DO (ทุนออกแบบ FIFO) → กำไรขั้นต้นต่อรายการคำนวณได้
  ✔ ทดสอบ: ตัวเลขกำไรตรงกับที่คำนวณมือ

**🏁 จบเฟส 5: ครบวงจร ซื้อ → สต๊อก → ขาย → เงิน**

---

## เฟส 6 — Hardening + รายงาน

- [x] **6.1 Audit log** — ตาราง log การ approve/cancel/post ทุกครั้ง (ใคร ทำอะไร เมื่อไหร่)
- [x] **6.2 รายงาน** — มูลค่าสต๊อกรวม ณ วันที่, ยอดขายรายเดือน, ลูกหนี้ค้างชำระตาม credit term, สินค้าใกล้ min_stock
- [x] **6.3 Review สิทธิ์ทุก endpoint** — ไล่ตารางว่า role ไหนทำอะไรได้ ตรงตามที่ตั้งใจ
- [x] **6.4 Load test เบา ๆ** — ยิงรับ/จ่ายพร้อมกัน 50 concurrent ดูว่าไม่มี deadlock/ยอดเพี้ยน แล้วรัน reconcile ต้องสะอาด
- [x] **6.5 Cron jobs** (`@nestjs/schedule` — ไม่ต้องมี infra เพิ่ม)
  - 02:00 ทุกคืน: reconcile balance vs SUM(movements) → ผิดปกติแจ้งทันที
  - ทุกวัน: QT เกินวันหมดอายุ → EXPIRED, แจ้งสินค้าต่ำกว่า min_stock, **แจ้ง lot ปูน/สีที่จะหมดอายุใน 30 วัน**, แจ้งประกันลูกค้าที่กำลังจะหมด (โอกาสขายซ้ำ), ล้าง refresh token หมดอายุ
  ✔ ทดสอบ: ตั้งเวลา cron ให้ยิงในอีก 1 นาทีแล้วดู log ว่าทำงานครบ
- [x] **6.6 รูปสินค้าผ่าน Cloudinary**
  เพิ่ม `products.image_public_id` + endpoint `POST /uploads/signature` (backend เซ็น signed upload ให้ — API secret ไม่หลุดไป frontend, รูปอัปโหลดตรงไป Cloudinary ไม่วิ่งผ่าน NestJS)
  ✔ ทดสอบ: ขอ signature → upload ผ่าน → เซฟ public_id → ดึง URL แบบ thumbnail transform ได้

---

## เฟส 7 — Frontend (Next.js) + สแกน barcode ด้วย iPhone

> Backend เสร็จครบแล้ว (189 เทสผ่าน) — หน้าบ้านต่อ API ได้ทันที

### หลัก UX ที่ยึดทุกหน้า (ไม่เน้นสวย เน้นใช้ง่าย ไม่พัง)

1. **ทุกอย่างเป็น URL จริง** — ตัวกรอง/หน้าที่/แท็บ เก็บใน query string → กดถอย/รีเฟรช/แชร์ลิงก์ได้เสมอ ไม่ใช้ modal ซ้อนหลายชั้น
2. **ปุ่มใหญ่ กดด้วยนิ้วโป้งได้** — หน้างานถือมือถือมือเดียว บางทีใส่ถุงมือ (ปุ่มหลักสูงอย่างน้อย 48px)
3. **มีสถานะครบทุกหน้า** — กำลังโหลด / ว่างเปล่า / ผิดพลาด (พร้อมปุ่มลองใหม่) ไม่ปล่อยจอขาว
4. **งานที่ทำลายข้อมูลต้องยืนยันเสมอ** — ยกเลิกเอกสาร/กลับรายการ ต้องกดยืนยันพร้อมบอกผลที่จะเกิด
5. **บอกความจริงเมื่อพลาด** — error จาก API เป็นภาษาไทยอยู่แล้ว เอามาแสดงตรง ๆ ไม่กลบด้วย "เกิดข้อผิดพลาด"
6. **มือถือมาก่อน** — เมนูล่างบนมือถือ / เมนูข้างบนจอใหญ่

- [x] **7.1 โครง + Auth + Layout**
  Next.js App Router + TS + Tailwind, token เก็บใน httpOnly cookie ผ่าน proxy ฝั่ง Next (กัน XSS ขโมย token), auto refresh, หน้า login, app shell + เมนู, ป้องกัน route
  ✔ ทดสอบ: login → เข้าหน้าหลัก, กด logout → กลับหน้า login, เข้าหน้าลึก ๆ ตอนยังไม่ login → เด้งไป login แล้วกลับมาที่เดิมหลัง login
- [x] **7.2 หน้า master data** — ตาราง + ฟอร์มสินค้า/คู่ค้า (ค้นหา+แบ่งหน้าอยู่ใน URL)
- [x] **7.3 หน้า stock card + ยอดคงเหลือ + ของใกล้หมด**
- [x] **7.4 หน้าสแกน barcode (มือถือ)**
  - ใช้ `@zxing/browser` อ่าน EAN-13/Code128 ผ่านกล้อง (iOS Safari ไม่มี BarcodeDetector API)
  - ต้องรัน dev แบบ **HTTPS** ไม่งั้น iOS ไม่ยอมเปิดกล้อง: `next dev --experimental-https` แล้วเปิดจาก iPhone ผ่าน IP เครื่อง dev ในวง WiFi เดียวกัน
  - Flow: ยิง → `GET /products/by-barcode/:code` → โชว์ชื่อ+ยอดคงเหลือ → ใส่จำนวน → เพิ่มเข้ารายการ
  ✔ ทดสอบ: ยิง barcode ของจริง (ขวดน้ำ/ขนม) ด้วย iPhone 14 Pro Max แล้วเจอสินค้าใน DB
- [ ] **7.5 หน้ารับของ (GR) / จ่ายของ (DO) แบบยิง barcode** — สแกนสะสมเป็น line แล้ว confirm, สินค้า SERIAL ยิง serial บนตัวเครื่องต่อเนื่องทีละเครื่อง, สินค้า LOT เลือก lot จากรายการ FEFO
- [ ] **7.6 หน้าเดินเอกสารขาย** — QT → SO → DO → INV → Payment (ราคาขึ้นตาม price level ลูกค้าอัตโนมัติ)
- [ ] **7.7 หน้าพิมพ์สติกเกอร์ QR** — ของไม่มี barcode โรงงาน (เหล็ก ท่อ ปูน) เลือกสินค้า+หน่วย → พิมพ์แผ่นสติกเกอร์ QR ติดชั้นวาง (พิมพ์จากหน้าเว็บได้เลย)
- [ ] **7.8 หน้าเช็คประกัน/เคลม** — ยิง serial บนเครื่องลูกค้า → เห็นทันที ซื้อวันไหน ประกันเหลือกี่วัน

---

## เฟส 8 — Production / Enterprise Readiness 🏭

> เป้าหมาย: ระบบใช้งานจริงได้แบบไม่ต้องลุ้น — ล่มรู้ก่อนผู้ใช้โทรมา, ข้อมูลไม่มีวันหาย, deploy ไม่มี downtime

- [ ] **8.1 Structured logging**
  pino (`nestjs-pino`) + request id ทุก log + log level ตาม env — ห้ามใช้ `console.log`
  ✔ ทดสอบ: ยิง request แล้ว log ทุกบรรทัดของ request นั้นมี request id เดียวกัน ไล่เรื่องได้

- [ ] **8.2 Health check + error tracking**
  `/healthz` (liveness) + `/readyz` (เช็ค DB ต่อได้จริง) ด้วย `@nestjs/terminus` + ต่อ Sentry เข้า global exception filter
  ✔ ทดสอบ: ดับ Postgres → `/readyz` ต้องแดง, โยน error ปลอม → ขึ้นใน Sentry dashboard

- [ ] **8.3 CI pipeline (GitHub Actions)**
  push/PR → lint → unit test (costing ต้อง 100%) → e2e (Postgres service container) → build — เขียวถึง merge ได้
  ✔ ทดสอบ: ตั้งใจ push test ที่พังไป → CI แดง block ไว้

- [ ] **8.4 Production Docker image**
  multi-stage Dockerfile (build → runner ตัวเล็ก, non-root user) + `docker-compose.prod.yml` (nestjs ×2 + nginx/Caddy + postgres + redis)
  ✔ ทดสอบ: `docker compose -f docker-compose.prod.yml up` แล้วระบบครบทุกตัวบนเครื่อง dev

- [ ] **8.5 Deploy จริง + HTTPS**
  VPS (เช่น DigitalOcean/Hetzner) หรือ cloud ไทย → โดเมน + Cloudflare (DNS/TLS/WAF) → firewall เปิดแค่ 80/443 → **DB/Redis ไม่ public** → DB user สิทธิ์ต่ำสุด
  ✔ ทดสอบ: สแกน port จากนอกเจอแค่ 80/443, เข้า https ได้เกรด A (ssllabs)

- [ ] **8.6 Backup + ทดสอบ restore (สำคัญที่สุดในเฟสนี้)**
  `pg_dump` ทุกคืนส่งขึ้น object storage นอกเครื่อง + เก็บ WAL สำหรับ PITR + **นัด restore ลงเครื่องเปล่าจริง ๆ เดือนละครั้ง**
  ✔ ทดสอบ: restore ลง DB เปล่า → รัน reconcile → สะอาด → ถือว่ามี backup จริง

- [ ] **8.7 Redis + BullMQ สำหรับงาน async**
  ตั้ง Redis → ย้าย throttler storage ไป Redis (แชร์ rate-limit ข้าม 2 instances) → BullMQ queue: ส่งอีเมล INV PDF, แจ้งเตือน — **การ post stock ยังเป็น sync ใน tx เหมือนเดิม ห้ามย้ายเข้า queue**
  ✔ ทดสอบ: สั่งส่งเมล 100 ฉบับ → API ตอบทันที งานทยอยทำใน queue, retry เองเมื่อ fail

- [ ] **8.8 Graceful shutdown + zero-downtime deploy**
  `app.enableShutdownHooks()` — รับ SIGTERM แล้วหยุดรับ request ใหม่ รอ tx ที่ค้างจบก่อนตาย + deploy แบบ rolling (ขึ้นตัวใหม่ ผ่าน `/readyz` ก่อนดับตัวเก่า)
  ✔ ทดสอบ: ยิง load ค้างไว้ระหว่าง deploy → ไม่มี request ไหนได้ 502

- [ ] **8.9 Monitoring + alert**
  uptime monitor (เช่น UptimeRobot/Better Stack) เช็ค `/healthz` ทุกนาที + alert เข้า LINE/email เมื่อ: เว็บล่ม, reconcile เจอยอดเพี้ยน, error rate พุ่ง
  ✔ ทดสอบ: ดับ app 2 นาที → มี alert เด้งเข้ามือถือ

- [ ] **8.10 Load test + security audit รอบสุดท้าย**
  k6/artillery ยิง 200 concurrent ผสม อ่าน/รับ/จ่าย → p95 < 300ms, reconcile สะอาด + `pnpm audit` ใน CI + ไล่ checklist ความปลอดภัยใน PLAN.md ครบทุกข้อ
  ✔ ทดสอบ: รายงาน load test + audit ผ่านเก็บไว้เป็นหลักฐาน

**🏁 จบเฟส 8: ระบบ enterprise ใช้งานจริง — มีหลักฐานพิสูจน์ทุกด้าน ไม่ใช่แค่ "น่าจะโอเค"**

---

## สรุปลำดับความสำคัญ

```
เฟส 0 ─▶ เฟส 1 ─▶ เฟส 2 ─▶ เฟส 3 ─▶ เฟส 3.5 ─▶ เฟส 4 ─▶ เฟส 5 ─▶ เฟส 6 ─▶ เฟส 8 (production)
                     │        (FIFO)   (serial/lot)
                     └────▶ เฟส 7 (frontend เริ่มขนานได้ตรงนี้)
```

**Step ถัดไปที่ต้องทำตอนนี้คือ 0.1** — เช็คเครื่องมือในเครื่องให้ครบ
