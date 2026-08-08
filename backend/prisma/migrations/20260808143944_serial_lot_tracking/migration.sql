-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('IN_STOCK', 'SOLD', 'CLAIMED', 'RETURNED');

-- AlterTable
ALTER TABLE "cost_layers" ADD COLUMN     "lot_id" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "lot_id" TEXT;

-- CreateTable
CREATE TABLE "serial_numbers" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "status" "SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "receive_movement_id" TEXT NOT NULL,
    "issue_movement_id" TEXT,
    "sold_to_partner_id" TEXT,
    "sold_at" TIMESTAMP(3),
    "warranty_end" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_serial_key" ON "serial_numbers"("serial");

-- CreateIndex
CREATE INDEX "serial_numbers_product_id_status_idx" ON "serial_numbers"("product_id", "status");

-- CreateIndex
CREATE INDEX "serial_numbers_warehouse_id_status_idx" ON "serial_numbers"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "serial_numbers_warranty_end_idx" ON "serial_numbers"("warranty_end");

-- CreateIndex
CREATE INDEX "lots_product_id_expiry_date_idx" ON "lots"("product_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "lots_product_id_lot_no_key" ON "lots"("product_id", "lot_no");

-- CreateIndex
CREATE INDEX "cost_layers_lot_id_idx" ON "cost_layers"("lot_id");

-- CreateIndex
CREATE INDEX "stock_movements_lot_id_warehouse_id_idx" ON "stock_movements"("lot_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_receive_movement_id_fkey" FOREIGN KEY ("receive_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_issue_movement_id_fkey" FOREIGN KEY ("issue_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_sold_to_partner_id_fkey" FOREIGN KEY ("sold_to_partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
