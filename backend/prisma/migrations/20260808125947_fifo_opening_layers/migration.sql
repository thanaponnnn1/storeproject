-- DropForeignKey
ALTER TABLE "cost_layers" DROP CONSTRAINT "cost_layers_source_movement_id_fkey";

-- AlterTable
ALTER TABLE "cost_layers" ADD COLUMN     "is_opening" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ALTER COLUMN "source_movement_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_source_movement_id_fkey" FOREIGN KEY ("source_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
