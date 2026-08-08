import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [InventoryModule, DocumentsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
