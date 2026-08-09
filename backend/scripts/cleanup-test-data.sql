-- ลบข้อมูลที่ชุดทดสอบอัตโนมัติสร้างทิ้งไว้ เก็บเฉพาะข้อมูลจริง
--
-- ทำทั้งหมดใน transaction เดียว — ถ้าติด foreign key ตรงไหนจะย้อนกลับทั้งหมด
-- ไม่มีทางเหลือข้อมูลค้างครึ่ง ๆ กลาง ๆ
--
-- รัน: docker exec -i storeproject-db psql -U store -d storedb < scripts/cleanup-test-data.sql

BEGIN;

-- ---------- 1. ระบุว่าอะไรคือ "ของจริง" ที่ต้องเก็บ ----------
-- ทุกอย่างที่ไม่ตรงรายการนี้ถือเป็นของทดสอบ
CREATE TEMP TABLE keep_products AS
SELECT id, sku FROM products WHERE
  -- ชุด seed ตั้งต้น
  sku IN ('AC-DK-12K','RF-SS-2D','PUMP-MT-155','DRL-MK-13','CEM-TPI-M199',
          'PAINT-TOA-WH1','STL-RB9','WIR-THW-1x1.5','PVC-SCG-2')
  -- ชุดสาธิต 20 รายการ
  OR sku ~ '^(AC-DKN|AC-MIT|RF-SAM|WM-LG|PUMP-MIT|WH-PAN|FAN-HAT|DRL-MAK|DRL-BOS|GRD-MAK|TAPE-STL|WRN-ADJ|LDR-ALU|SCR-SET|CEM-SCG|PNT-TOA|STL-RB9-10M|STL-DB12|WIR-THW-25)'
  -- ชุดทดสอบรับของ 10 รายการ
  OR sku ~ '^(COMP-PUMA|FRZ-SAN|ADH-JAG|PNT-BGR|PPR-SCG|WIR-VAF|SAW-MAK|STOVE-LUC|RC-SHP|TILE-COT)';

CREATE TEMP TABLE junk_products AS
SELECT id FROM products WHERE id NOT IN (SELECT id FROM keep_products);

-- ---------- 2. เอกสารที่แตะสินค้าทดสอบ = เอกสารทดสอบ ----------
-- ลามไปตามลูกโซ่ด้วย: ใบสั่งขายที่มาจากใบเสนอราคาทดสอบก็เป็นของทดสอบ
CREATE TEMP TABLE junk_qt AS
SELECT DISTINCT quotation_id AS id FROM quotation_lines
WHERE product_id IN (SELECT id FROM junk_products);

CREATE TEMP TABLE junk_so AS
SELECT DISTINCT sales_order_id AS id FROM sales_order_lines
WHERE product_id IN (SELECT id FROM junk_products);
INSERT INTO junk_so
SELECT id FROM sales_orders
WHERE quotation_id IN (SELECT id FROM junk_qt)
  AND id NOT IN (SELECT id FROM junk_so);

CREATE TEMP TABLE junk_do AS
SELECT DISTINCT delivery_order_id AS id FROM delivery_order_lines
WHERE product_id IN (SELECT id FROM junk_products);
INSERT INTO junk_do
SELECT id FROM delivery_orders
WHERE sales_order_id IN (SELECT id FROM junk_so)
  AND id NOT IN (SELECT id FROM junk_do);

CREATE TEMP TABLE junk_inv AS
SELECT DISTINCT invoice_id AS id FROM invoice_lines
WHERE product_id IN (SELECT id FROM junk_products);
INSERT INTO junk_inv
SELECT id FROM invoices
WHERE sales_order_id IN (SELECT id FROM junk_so)
  AND id NOT IN (SELECT id FROM junk_inv);

CREATE TEMP TABLE junk_po AS
SELECT DISTINCT purchase_order_id AS id FROM purchase_order_lines
WHERE product_id IN (SELECT id FROM junk_products);

CREATE TEMP TABLE junk_gr AS
SELECT DISTINCT goods_receipt_id AS id FROM goods_receipt_lines
WHERE product_id IN (SELECT id FROM junk_products);
INSERT INTO junk_gr
SELECT id FROM goods_receipts
WHERE purchase_order_id IN (SELECT id FROM junk_po)
  AND id NOT IN (SELECT id FROM junk_gr);

-- ---------- 3. ลบเอกสาร (ลูกก่อนแม่ ตามลูกโซ่ย้อนกลับ) ----------
DELETE FROM payment_allocations WHERE invoice_id IN (SELECT id FROM junk_inv);
-- ใบรับชำระที่ไม่เหลือใบแจ้งหนี้ให้ตัดแล้ว = ของทดสอบล้วน
DELETE FROM payments p
WHERE NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id);

DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM junk_inv);
DELETE FROM invoices      WHERE id IN (SELECT id FROM junk_inv);

DELETE FROM delivery_order_lines WHERE delivery_order_id IN (SELECT id FROM junk_do);
DELETE FROM delivery_orders      WHERE id IN (SELECT id FROM junk_do);

DELETE FROM sales_order_lines WHERE sales_order_id IN (SELECT id FROM junk_so);
DELETE FROM sales_orders      WHERE id IN (SELECT id FROM junk_so);

DELETE FROM quotation_lines WHERE quotation_id IN (SELECT id FROM junk_qt);
DELETE FROM quotations      WHERE id IN (SELECT id FROM junk_qt);

DELETE FROM goods_receipt_lines WHERE goods_receipt_id IN (SELECT id FROM junk_gr);
DELETE FROM goods_receipts      WHERE id IN (SELECT id FROM junk_gr);

DELETE FROM purchase_order_lines WHERE purchase_order_id IN (SELECT id FROM junk_po);
DELETE FROM purchase_orders      WHERE id IN (SELECT id FROM junk_po);

-- ---------- 4. ลบข้อมูลสต๊อกของสินค้าทดสอบ ----------
-- ต้นทุน: consumption อ้าง layer และ movement จึงต้องไปก่อนทั้งคู่
DELETE FROM cost_layer_consumptions
WHERE layer_id IN (SELECT id FROM cost_layers WHERE product_id IN (SELECT id FROM junk_products))
   OR issue_movement_id IN (SELECT id FROM stock_movements WHERE product_id IN (SELECT id FROM junk_products));
DELETE FROM cost_layers WHERE product_id IN (SELECT id FROM junk_products);

DELETE FROM serial_numbers WHERE product_id IN (SELECT id FROM junk_products);
DELETE FROM stock_balances WHERE product_id IN (SELECT id FROM junk_products);

-- movement อ้างตัวเองผ่าน reversal_of_id — ลบตัวกลับรายการก่อน
DELETE FROM stock_movements
WHERE product_id IN (SELECT id FROM junk_products) AND reversal_of_id IS NOT NULL;
DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM junk_products);

DELETE FROM lots             WHERE product_id IN (SELECT id FROM junk_products);
DELETE FROM product_barcodes WHERE product_id IN (SELECT id FROM junk_products);
DELETE FROM product_units    WHERE product_id IN (SELECT id FROM junk_products);

-- ---------- 5. ลบตัวสินค้าและคู่ค้าทดสอบ ----------
DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM junk_products);
DELETE FROM products   WHERE id IN (SELECT id FROM junk_products);

-- คู่ค้าที่ชุดทดสอบสร้าง และไม่มีเอกสารไหนอ้างถึงแล้ว
DELETE FROM partners p
WHERE p.code ~ '^(UI-|HACK-)'
  AND NOT EXISTS (SELECT 1 FROM quotations      x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM sales_orders    x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM delivery_orders x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM invoices        x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM payments        x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_orders x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM goods_receipts  x WHERE x.partner_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM serial_numbers  x WHERE x.sold_to_partner_id = p.id);

-- หน่วยนับที่ชุดทดสอบสร้าง (SETxxxxxx) และไม่มีใครใช้
DELETE FROM uoms u
WHERE u.code ~ '^SET[0-9]+$'
  AND NOT EXISTS (SELECT 1 FROM products     x WHERE x.base_uom_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM product_units x WHERE x.uom_id = u.id);

COMMIT;
