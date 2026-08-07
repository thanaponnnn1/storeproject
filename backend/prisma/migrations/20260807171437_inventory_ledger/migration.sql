-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVE', 'ISSUE', 'ADJUST_IN', 'ADJUST_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "total_cost" DECIMAL(18,2) NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "ref_doc_type" TEXT NOT NULL,
    "ref_doc_id" TEXT NOT NULL,
    "note" TEXT,
    "reversal_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "qty_on_hand" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("product_id","warehouse_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reversal_of_id_key" ON "stock_movements"("reversal_of_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_warehouse_id_created_at_idx" ON "stock_movements"("product_id", "warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_ref_doc_type_ref_doc_id_idx" ON "stock_movements"("ref_doc_type", "ref_doc_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
