-- CreateTable
CREATE TABLE "cost_layers" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "source_movement_id" TEXT NOT NULL,
    "original_qty" DECIMAL(18,3) NOT NULL,
    "remaining_qty" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_layer_consumptions" (
    "id" TEXT NOT NULL,
    "layer_id" TEXT NOT NULL,
    "issue_movement_id" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_layer_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_layers_source_movement_id_key" ON "cost_layers"("source_movement_id");

-- CreateIndex
CREATE INDEX "cost_layers_product_id_warehouse_id_received_at_idx" ON "cost_layers"("product_id", "warehouse_id", "received_at");

-- CreateIndex
CREATE INDEX "cost_layer_consumptions_issue_movement_id_idx" ON "cost_layer_consumptions"("issue_movement_id");

-- CreateIndex
CREATE INDEX "cost_layer_consumptions_layer_id_idx" ON "cost_layer_consumptions"("layer_id");

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_source_movement_id_fkey" FOREIGN KEY ("source_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layer_consumptions" ADD CONSTRAINT "cost_layer_consumptions_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layer_consumptions" ADD CONSTRAINT "cost_layer_consumptions_issue_movement_id_fkey" FOREIGN KEY ("issue_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
