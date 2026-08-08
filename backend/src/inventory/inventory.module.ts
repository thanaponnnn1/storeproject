import { Module } from '@nestjs/common';
import { AverageStrategy } from './costing/average.strategy';
import { CostingService } from './costing/costing.service';
import { FifoStrategy } from './costing/fifo.strategy';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { TrackingService } from './tracking/tracking.service';

@Module({
  controllers: [InventoryController],
  providers: [
    InventoryService,
    CostingService,
    AverageStrategy,
    FifoStrategy,
    TrackingService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
