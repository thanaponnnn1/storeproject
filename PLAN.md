# แผนพัฒนาระบบคลังสินค้า + ซื้อ-ขายครบวงจร (ERP-lite)

> ธุรกิจ: **ร้านเครื่องใช้ไฟฟ้า + อุปกรณ์ช่าง + วัสดุก่อสร้าง** (ระดับ enterprise ใช้งานจริง)
> มุมมอง: หัวหน้าคลังสินค้า (business rules) + Senior Dev (architecture)
> Stack: **NestJS (Backend) + Next.js (Frontend) + PostgreSQL**
> เริ่มจาก Backend ก่อน — เน้น เร็ว / ปลอดภัย / บำรุงรักษาง่าย

---

## 1. ภาพรวม: สองโปรเจกต์คือระบบเดียวกัน

โปรเจกต์ 1 (คลัง+สต๊อก) คือ **แกนกลาง** ของโปรเจกต์ 2 (ซื้อ-ขาย)
เอกสารทุกใบสุดท้ายจะมา "post" ลง ledger ของคลัง:

```
ฝั่งขาย:  ใบเสนอราคา (QT) → ใบสั่งขาย (SO) → ใบส่งของ (DO) ──┐
ฝั่งซื้อ:  ใบสั่งซื้อ (PO) → ใบรับของ (GR) ────────────────────┤
                                                              ▼
                                              📒 stock_movements (ledger)
                                                              ▼
DO → ใบแจ้งหนี้ (INV) → ใบเสร็จรับเงิน (Payment)      stock card / ต้นทุน / ยอดคงเหลือ
```

**ลำดับการสร้างจึงต้องเป็น: คลังก่อน → เอกสารทีหลัง**

---

## 2. กฎเหล็กจากหัวหน้าคลัง (Business Rules ที่ห้ามละเมิด)

1. **ห้าม UPDATE ยอดสต๊อกตรง ๆ เด็ดขาด** — ยอดคงเหลือคือ "ผลรวม" ของ movement ทั้งหมด (ledger pattern)
2. **ทุก movement ต้องอ้างอิงเอกสาร** — ไม่มีของเข้า/ออกลอย ๆ (`ref_doc_type` + `ref_doc_id` ห้าม null)
3. **ห้ามลบ movement** — ถ้าผิด ให้สร้าง **reversal movement** (รายการกลับรายการ) แล้วอ้างถึงตัวที่ผิด
4. **ห้ามสต๊อกติดลบ** (ค่า default) — จ่ายออกเกินยอดคงเหลือ = reject ที่ระดับ transaction
5. **ยกเลิกเอกสาร ≠ ลบเอกสาร** — เปลี่ยน status เป็น CANCELLED + สร้าง reversal ถ้า post ไปแล้ว
6. **นับสต๊อกจริง (stock take)** ต่างจากระบบ → ออกเอกสารปรับยอด (Adjustment) เท่านั้น
7. **ส่งของบางส่วนได้ (partial fulfillment)** — SO 100 ชิ้น ส่ง 60 ก่อนได้ ระบบต้อง track ยอดค้างส่งราย line

### 2.1 ธรรมชาติสินค้า 3 กลุ่ม (ตัวกำหนดดีไซน์)

| กลุ่ม | ตัวอย่าง | สิ่งที่ต้อง track เพิ่ม |
|---|---|---|
| **เครื่องใช้ไฟฟ้า** | แอร์ ตู้เย็น ทีวี เครื่องซักผ้า | **Serial number รายเครื่อง** — รับเข้า/จ่ายออกต้องยิง serial ทุกเครื่อง, ประกันนับจากวันขาย, เคลมค้นจาก serial / มี barcode โรงงาน |
| **อุปกรณ์ช่าง** | สว่าน หินเจียร ประแจ ปั๊มน้ำ | ขายเป็นชิ้น, บาง SKU มีประกัน (ตาม serial หรือใบเสร็จ) / มี barcode โรงงาน |
| **วัสดุก่อสร้าง** | ปูน เหล็กเส้น สายไฟ ท่อ PVC สี | **หลายหน่วยนับ** (เหล็ก: เส้น/มัด, สายไฟ: เมตร/ม้วน) → จำนวนเป็น**ทศนิยม**, ปูน/สี/เคมีภัณฑ์มี **lot + วันหมดอายุ → จ่ายแบบ FEFO** (ใกล้หมดอายุออกก่อน), ส่วนใหญ่**ไม่มี barcode โรงงาน → พิมพ์ QR ภายในติดเอง** |

กฎเพิ่มจากธรรมชาติสินค้า:

8. **สินค้า SERIAL** — จำนวนใน movement ต้องเท่ากับจำนวน serial ที่ยิงเสมอ ห้ามรับ/จ่ายแบบไม่ระบุ serial
9. **สินค้า LOT (ปูน/สี)** — รับเข้าต้องระบุ lot + วันหมดอายุ, ระบบแนะนำจ่าย lot ใกล้หมดอายุก่อน (FEFO), cron แจ้งเตือนของใกล้หมดอายุ
10. **สต๊อกเก็บหน่วยฐานเสมอ** — ขาย "2 มัด" ระบบแปลงเป็น 20 เส้นก่อนตัด ledger, ราคาขายผูกกับหน่วยขายได้
11. **ราคาลูกค้า 3 ระดับ** — ปลีก / ช่างประจำ / โครงการ ดึงอัตโนมัติตาม price level ของลูกค้า, แก้ราคาหน้าบิลต้องมีสิทธิ์

---

## 3. Tech Stack (ตัดสินใจแล้ว พร้อมเหตุผล)

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| Framework | NestJS 10 + TypeScript strict | ตามโจทย์, module system ชัด บำรุงง่าย |
| Database | **PostgreSQL 16** | ต้องการ ACID transaction + `SELECT ... FOR UPDATE` สำหรับกันแย่งสต๊อก |
| ORM | **Prisma** | Type-safe, migration ง่าย, interactive transaction รองรับ locking ที่เราต้องใช้ |
| Auth | JWT access (15 นาที) + refresh token rotation, **Argon2id** hash | มาตรฐานปัจจุบัน ปลอดภัยกว่า bcrypt |
| Authorization | RBAC (Role → Permission) ผ่าน Guard + decorator | คลังต้องแยกสิทธิ์: คนคีย์รับของ ≠ คนอนุมัติปรับยอด |
| Validation | class-validator + `whitelist: true, forbidNonWhitelisted: true` | กัน mass assignment |
| API Docs | Swagger (@nestjs/swagger) | ให้ frontend ต่อได้เลย |
| Security middleware | helmet, @nestjs/throttler (rate limit), CORS whitelist | baseline ความปลอดภัย |
| Testing | Jest (unit) + Supertest (e2e) — **บังคับ test เครื่องคิดต้นทุน 100%** | ต้นทุนผิด = งบการเงินผิดทั้งบริษัท |
| Dev infra | docker-compose (Postgres + pgAdmin) | ทุกเครื่อง dev เหมือนกัน |

ค่าเริ่มต้นเชิงธุรกิจ: บริษัทเดียว (single-tenant), **รองรับหลายคลัง (multi-warehouse) ตั้งแต่ schema** แต่เฟสแรกใช้คลังเดียว, วิธีคิดต้นทุน**กำหนดรายสินค้า** (default = Moving Average, สลับเป็น FIFO ได้)

---

## 4. Database Design — หัวใจของระบบ

### 4.1 Master Data
```
products         (id, sku UNIQUE, name, brand, model,
                  base_uom_id, category_id,
                  tracking_type [NONE|SERIAL|LOT],     -- แอร์=SERIAL, ปูน=LOT, น็อต=NONE
                  warranty_months,                      -- ประกันนับจากวันขาย
                  price_retail, price_contractor, price_project,  -- ปลีก/ช่าง/โครงการ (ต่อหน่วยฐาน)
                  costing_method [FIFO|AVG], min_stock, is_active, timestamps, created_by)

product_units    (id, product_id, uom_id, conversion_factor, sale_price NULL)
                 -- 1 มัดเหล็ก = 10 เส้น, 1 ม้วนสายไฟ = 100 เมตร
                 -- สต๊อก/ledger เก็บหน่วยฐานเสมอ ขายหน่วยไหนระบบแปลงให้

product_barcodes (id, product_id, product_unit_id, barcode UNIQUE)
                 -- ชิ้นกับลังคนละ barcode ได้ / ของไม่มี barcode โรงงาน (เหล็ก,ท่อ)
                 -- → ระบบ generate QR ภายใน พิมพ์สติกเกอร์ติดชั้นวาง

uoms             (id, code, name)          -- ชิ้น, เส้น, มัด, เมตร, ม้วน, ถุง, ลัง
categories       (id, name, parent_id)
warehouses       (id, code, name, is_active)
partners         (id, code, name, type [CUSTOMER|SUPPLIER|BOTH], tax_id, address,
                  credit_term_days, price_level [RETAIL|CONTRACTOR|PROJECT])
```

### 4.1.1 Serial & Lot tracking
```
serial_numbers (id, product_id, serial UNIQUE, warehouse_id,
                status [IN_STOCK|SOLD|CLAIMED|RETURNED],
                receive_movement_id,           -- เข้ามาจาก GR ใบไหน
                issue_movement_id NULL,        -- ขายออกไปกับ DO ใบไหน
                sold_to_partner_id NULL, sold_at NULL, warranty_end NULL)
                -- หน้าเคลม: ยิง serial → รู้ทันทีซื้อเมื่อไหร่ ประกันเหลือกี่วัน

lots           (id, product_id, lot_no, expiry_date, received_at)
stock_movements.lot_id NULL                    -- movement ของสินค้า LOT ต้องระบุ lot
                -- จ่ายออก: ระบบแนะนำ lot ใกล้หมดอายุก่อน (FEFO)
```
- จำนวนทุกที่ในระบบเป็น **DECIMAL(18,3)** ไม่ใช่ int — สายไฟ 12.5 เมตรต้องได้
- สินค้า SERIAL: จำนวน movement = จำนวน serial เสมอ (บังคับใน service)

### 4.2 Inventory Ledger (append-only — ห้ามมี endpoint UPDATE/DELETE)
```
stock_movements (id, product_id, warehouse_id,
                 qty            -- ค่าบวก=เข้า ค่าลบ=ออก (signed)
                 unit_cost, total_cost,
                 movement_type  [RECEIVE|ISSUE|ADJUST_IN|ADJUST_OUT|TRANSFER_IN|TRANSFER_OUT|REVERSAL],
                 ref_doc_type, ref_doc_id,        -- บังคับ NOT NULL
                 reversal_of_id NULL,             -- ชี้ movement ที่ถูกกลับรายการ
                 created_at, created_by)
        INDEX (product_id, warehouse_id, created_at)

stock_balances  (product_id, warehouse_id, qty_on_hand, avg_cost, updated_at)
                -- ⚠️ เป็นแค่ CACHE เพื่อความเร็ว อัปเดตใน transaction เดียวกับ movement
                -- source of truth คือ SUM(stock_movements) เสมอ + มี job/endpoint reconcile ตรวจกระทบยอด
```

### 4.3 ต้นทุน FIFO (cost layers)
```
cost_layers            (id, product_id, warehouse_id, source_movement_id,
                        original_qty, remaining_qty, unit_cost, received_at)
cost_layer_consumptions(id, layer_id, issue_movement_id, qty, unit_cost)
```
- **รับเข้า** → สร้าง layer ใหม่
- **จ่ายออก** → กินจาก layer เก่าสุดก่อน (ORDER BY received_at) บันทึก consumption ไว้ตรวจสอบย้อนหลังได้
- **Average** → ไม่ใช้ layer: `avg ใหม่ = (ยอดเดิม×avg เดิม + qty เข้า×ทุนเข้า) / (ยอดเดิม + qty เข้า)`

ออกแบบเป็น `CostingStrategy` interface (`FifoStrategy` / `AverageStrategy`) — service เลือกตาม `product.costing_method`

### 4.4 เอกสาร (โครงเดียวกันทุกใบ: header + lines + status)
```
documents ทุกประเภทมี: doc_no UNIQUE, status, partner_id, doc_date, remark,
                        created_by, approved_by, timestamps
lines ทุกประเภทมี:      product_id, qty, unit_price, discount, line_total,
                        source_line_id  -- ชี้ line ของเอกสารต้นทาง (ลูกโซ่เอกสาร + partial)

quotations / quotation_lines
sales_orders / so_lines          (so_lines มี qty_delivered, qty_invoiced สะสม)
delivery_orders / do_lines       → ตอน CONFIRM: post ISSUE ลง ledger
invoices / invoice_lines         (มี amount_paid สะสม)
payments / payment_allocations   (1 payment ตัดได้หลาย invoice)
purchase_orders / po_lines       (po_lines มี qty_received สะสม)
goods_receipts / gr_lines        → ตอน CONFIRM: post RECEIVE ลง ledger + สร้าง cost layer

document_counters (doc_type, period, last_no)  -- ออกเลขรันใน transaction + FOR UPDATE
                                               -- รูปแบบ: QT-2026-08-0001
```

### 4.5 State Machine ต่อเอกสาร
```
QT :  DRAFT → SUBMITTED → APPROVED → CONVERTED   (หรือ → EXPIRED / CANCELLED)
SO :  DRAFT → CONFIRMED → PARTIALLY_DELIVERED → DELIVERED → CLOSED   (→ CANCELLED ได้ก่อนส่งของ)
DO :  DRAFT → CONFIRMED(post stock) → CANCELLED(สร้าง reversal)
INV:  DRAFT → ISSUED → PARTIALLY_PAID → PAID     (→ VOID)
PO :  DRAFT → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED
GR :  DRAFT → CONFIRMED(post stock + layer) → CANCELLED(reversal)
```
บังคับ transition ผ่านตารางกลาง `ALLOWED_TRANSITIONS: Record<DocType, Record<Status, Status[]>>`
เปลี่ยนสถานะนอกตาราง = throw ทันที และการเปลี่ยนสถานะ + side effect (post stock, ตัดยอด) ต้องอยู่ใน **transaction เดียว**

### 4.6 Concurrency (จุดที่พังบ่อยที่สุด)
ทุกการจ่ายออก/รับเข้า ทำใน Prisma interactive transaction:
```
1. SELECT stock_balances FOR UPDATE (lock แถว product+warehouse)   ← กัน 2 คนจ่ายพร้อมกัน
2. ตรวจยอดพอไหม (ห้ามติดลบ)
3. คิดต้นทุน (strategy)
4. INSERT stock_movement (+ consume/create layers)
5. UPDATE stock_balances (cache)
6. UPDATE ยอดสะสมบน line เอกสารต้นทาง
COMMIT — พังข้อไหน rollback ทั้งหมด
```

---

## 5. โครงสร้าง Module (NestJS)

```
src/
├── common/          # pagination, exception filter, transaction helper, audit decorator
├── config/          # env validation (joi/zod) — app ไม่ start ถ้า env ไม่ครบ
├── auth/            # login, refresh rotation, guards, RBAC decorator
├── users/           # ผู้ใช้ + role + permission
├── master/
│   ├── products/  ├── uoms/  ├── categories/  ├── warehouses/  └── partners/
├── inventory/
│   ├── movements/   # รับเข้า/จ่ายออก/ปรับยอด/โอนคลัง (append-only)
│   ├── costing/     # CostingStrategy: FIFO / Average + tests หนัก ๆ
│   ├── balances/    # ยอดคงเหลือ + reconcile
│   └── stock-card/  # รายงานความเคลื่อนไหว + running balance
├── documents/
│   ├── core/        # base doc service, state machine, เลขรันเอกสาร
│   ├── quotations/ ├── sales-orders/ ├── deliveries/ ├── invoices/ ├── payments/
│   ├── purchase-orders/ └── goods-receipts/
└── reports/         # มูลค่าสต๊อก, ยอดขาย, ลูกหนี้ค้างชำระ
```

---

## 6. แผนงานเป็นเฟส (ทำตามลำดับ แต่ละเฟสจบแล้วใช้งานได้จริง)

| เฟส | งาน | Definition of Done |
|---|---|---|
| **0. Foundation** | Scaffold NestJS, docker-compose Postgres, Prisma, config+env validation, Swagger, helmet/throttler, Auth (JWT+refresh+Argon2), RBAC | login ได้, endpoint ถูกป้องกันด้วย role, `docker compose up` แล้ว dev ได้ทันที |
| **1. Master Data** | products, uoms, categories, warehouses, partners (CRUD + soft delete ด้วย is_active) | คีย์สินค้า/คู่ค้า/คลังครบผ่าน Swagger |
| **2. Inventory Ledger + Average** | stock_movements, รับเข้า/จ่ายออก/ปรับยอด, stock_balances cache, ต้นทุน Average, stock card, กันติดลบ + FOR UPDATE | รับ-จ่ายของแล้ว stock card ถูก, ทุน avg ถูก, ยิงจ่ายพร้อมกัน 2 request แล้วไม่ทะลุยอด (มี e2e test พิสูจน์) |
| **3. FIFO** | cost_layers + consumptions, FifoStrategy, สลับ method รายสินค้า, รายงาน reconcile balance vs SUM(movements) | test case ชุด FIFO ผ่าน (รับ 3 lot ราคาต่างกัน จ่ายคร่อม lot แล้วทุนถูกเป๊ะ) |
| **4. Sales Flow** | QT→SO→DO→INV→Payment + state machine + เลขรันเอกสาร + partial delivery/payment, DO confirm แล้ว post ISSUE | เดินเอกสารครบสายจนรับเงิน, ยกเลิก DO แล้ว stock กลับมาถูกต้องแบบ reversal |
| **5. Purchase Flow** | PO→GR, GR confirm → post RECEIVE + สร้าง cost layer, ตัดยอดค้างรับ | ซื้อเข้าจนสต๊อกขึ้น ต้นทุนไหลเข้า layer ถูก |
| **6. Hardening** | audit log, รายงานรวม, seed data, load test เบา ๆ, review สิทธิ์ทุก endpoint | พร้อมให้ frontend เริ่มต่อเต็มตัว |

Frontend (Next.js) เริ่มขนานได้ตั้งแต่จบเฟส 2 เพราะ Swagger นิ่งแล้วในส่วนคลัง

### อุปกรณ์หน้างาน: ใช้ iPhone 14 Pro Max เป็นเครื่องยิง barcode

- Backend ต้องมี: ตาราง `product_barcodes` + endpoint `GET /products/by-barcode/:code`
  → คืน **สินค้า + หน่วยนับของ barcode นั้น + ตัวคูณแปลงหน่วย + ยอดคงเหลือ** (ยิงลังได้ลัง ยิงชิ้นได้ชิ้น)
- ของที่ไม่มี barcode โรงงาน (เหล็กเส้น ท่อ ปูน) → ระบบ generate QR ภายใน + หน้าพิมพ์สติกเกอร์ติดชั้นวาง
- สินค้า SERIAL (แอร์/ตู้เย็น): ยิง serial บนตัวเครื่องตอนรับเข้า-จ่ายออก และหน้าเคลมยิง serial เพื่อเช็คประกัน
- Frontend ทำเป็น **หน้าเว็บสแกนบนมือถือ (PWA)** เปิดผ่าน Safari:
  - iOS Safari **ไม่มี** `BarcodeDetector` API → ใช้ไลบรารี `@zxing/browser` (หรือ `html5-qrcode`)
    อ่าน EAN-13 / Code128 ผ่านกล้องได้ดีบน iPhone 14 Pro Max
  - กล้องบน iOS ใช้ได้เฉพาะ **HTTPS** → ตอน dev ในวง LAN ต้องรัน dev server แบบ https
    (เช่น `next dev --experimental-https` หรือ mkcert) แล้วเปิดจาก IP เครื่อง dev
  - Flow หน้างาน: ยิง barcode → lookup สินค้า → ใส่จำนวน → เพิ่มเข้า line เอกสาร (GR/DO) → confirm

---

## 7. Infra เสริม — อะไรใช้ตอนไหน (คำตัดสิน)

หลักคิด: **อย่าเพิ่ม infra ที่ต้องดูแลเพิ่ม ถ้า Postgres ตัวเดียวยังรับไหว** — ทุกชิ้นที่เพิ่มคือภาระ ops + จุดพังใหม่

| ของ | คำตัดสิน | เหตุผล |
|---|---|---|
| **DB Index** | ✅ จำเป็น (อยู่ในแผนแล้ว) | แต่ ledger เป็นระบบ **write หนัก** — index เกินจำเป็นทำให้เขียนช้า ใส่เฉพาะที่ query จริง แล้วพิสูจน์ด้วย `EXPLAIN ANALYZE` ก่อนเพิ่มตัวใหม่ |
| **Cron job** | ✅ คุ้มสุด เบาสุด | ใช้ `@nestjs/schedule` ไม่ต้องมี infra เพิ่มเลย: reconcile กลางคืน, QT หมดอายุ, แจ้ง min_stock, ล้าง refresh token หมดอายุ |
| **Cloudinary** | ✅ เหมาะกับรูปสินค้า | เก็บแค่ `image_public_id` ใน DB, frontend upload **ตรงไป Cloudinary** ด้วย signature ที่ backend เซ็นให้ (รูปไม่วิ่งผ่าน NestJS = เบา), ได้ thumbnail transform ฟรี |
| **Redis** | 🕐 เฟส 8 (production) | ใช้เป็น **backend ของ BullMQ + shared rate-limit** ตอนรัน NestJS หลาย instance — แต่ **ห้าม cache "ยอดสต๊อก" ใน Redis เด็ดขาด** (stale = ขายของที่ไม่มี) `stock_balances` ใน Postgres คือ cache ที่ update ใน tx เดียวกันอยู่แล้ว consistent กว่า |
| **Queue** | 🕐 เฟส 8 (production) | **ห้ามเอา queue มาคั่นการ post stock** — การตัดสต๊อกต้อง sync ใน tx เดียว ไม่งั้นเช็คติดลบไม่ได้ / queue ใช้กับงาน async จริง ๆ: ส่งอีเมล INV PDF, แจ้งเตือน LINE, รายงานหนัก — สำหรับ monolith ใช้ **BullMQ** (integrate กับ NestJS ง่าย, ใช้ Redis ที่มีอยู่แล้ว) / **RabbitMQ ค่อยเข้ามาเมื่อแตกเป็นหลาย service** + ใช้ **outbox pattern** เมื่อยิง event จากใน transaction |

Index ชุดแรกที่ต้องมี (ตาม query ที่ใช้บ่อย):
```
stock_movements (product_id, warehouse_id, created_at)   -- stock card
products.barcode UNIQUE, products.sku UNIQUE             -- lookup หน้างาน
ทุกตารางเอกสาร: doc_no UNIQUE, (partner_id, doc_date), (status)
invoices (status, due_date)                              -- ลูกหนี้ค้างชำระ
```

### 7.1 สถาปัตยกรรม Production (enterprise ใช้งานจริง)

```
                    Cloudflare (DNS + TLS + WAF + กัน DDoS ระดับหนึ่ง)
                                      │
                          nginx / Caddy (reverse proxy)
                                      │
                    NestJS × 2 instances (Docker, graceful shutdown)
                     │                │                    │
        PostgreSQL 16              Redis              Cloudinary
        (primary + WAL backup     (BullMQ jobs +     (รูปสินค้า + CDN)
         + daily dump + PITR)      shared throttler)
```

สิ่งที่ทำให้ "enterprise จริง" ไม่ใช่จำนวน infra แต่คือวินัยเหล่านี้:

| ด้าน | ต้องมี |
|---|---|
| **Observability** | structured log (pino + request id), error tracking (Sentry), `/healthz` + `/readyz`, uptime monitor + alert |
| **Reliability** | backup อัตโนมัติทุกวัน + **ทดสอบ restore จริงทุกเดือน** (backup ที่ไม่เคย restore = ไม่มี backup), graceful shutdown รอ tx จบก่อนตาย, zero-downtime deploy |
| **CI/CD** | pipeline: lint → test (costing 100%) → build → migrate → deploy — **ห้าม deploy มือ** |
| **Security ops** | DB user สิทธิ์ต่ำสุด (ไม่ใช่ superuser), DB ไม่เปิด public, secret อยู่นอก repo, `pnpm audit` ใน CI, firewall เปิดแค่ 80/443 |
| **Data** | migration ผ่าน Prisma เท่านั้น (ห้ามแก้ schema มือ), ทุกการแก้ข้อมูล production มี audit trail |

## 8. ความปลอดภัย (สรุป checklist)

- [ ] Argon2id + JWT สั้น + refresh rotation (detect reuse → revoke ทั้ง family)
- [ ] RBAC: แยกสิทธิ์ อ่าน/คีย์/อนุมัติ/ยกเลิก ต่อเอกสารแต่ละประเภท
- [ ] ValidationPipe whitelist ทุก DTO — กัน field แปลกปลอม
- [ ] ไม่มี raw SQL ต่อ string (Prisma parameterized ทั้งหมด)
- [ ] helmet + rate limit + CORS ระบุ origin ชัด
- [ ] Audit: created_by/updated_by ทุกตาราง + log การอนุมัติ/ยกเลิกเอกสาร
- [ ] เอกสารและ movement ไม่มี hard delete
- [ ] env ผ่าน validation, secret ไม่อยู่ใน repo

---

## 8. สิ่งที่ได้เรียนรู้ (mapping กับโจทย์)

- **Ledger pattern** → เฟส 2: ยอดคงเหลือเกิดจาก SUM(movements) + cache ที่ reconcile ได้
- **การคิดต้นทุน** → เฟส 2 (Average) + เฟส 3 (FIFO layers) ผ่าน Strategy pattern
- **Document flow + state machine** → เฟส 4-5: ตาราง transition + ลูกโซ่ `source_line_id` + partial fulfillment
- **Concurrency จริงของระบบคลัง** → FOR UPDATE + transaction boundary ที่ถูกต้อง
