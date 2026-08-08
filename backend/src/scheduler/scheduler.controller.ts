import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { InventoryService } from '../inventory/inventory.service';
import { QuotationsService } from '../documents/quotations/quotations.service';
import { SchedulerService } from './scheduler.service';

/**
 * ยิงงานประจำเองได้โดยไม่ต้องรอเวลา — ใช้ตอนทดสอบและตอนต้องการผลทันที
 * (เช่น หลังกู้ข้อมูลอยากรัน reconcile เดี๋ยวนั้น)
 */
@ApiTags('scheduler')
@ApiBearerAuth()
@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly inventory: InventoryService,
    private readonly quotations: QuotationsService,
  ) {}

  @Post('run/reconcile')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'รันตรวจกระทบยอดเดี๋ยวนี้' })
  reconcile() {
    return this.inventory.reconcile();
  }

  @Post('run/expire-quotations')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ทำใบเสนอราคาที่เลยกำหนดให้หมดอายุเดี๋ยวนี้' })
  expireQuotations() {
    return this.quotations.expireOverdue();
  }

  @Post('run/daily-alerts')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({
    summary: 'สรุปแจ้งเตือนประจำวัน (ของใกล้หมด/ล็อตใกล้หมดอายุ/หนี้เกินกำหนด)',
  })
  dailyAlerts() {
    return this.scheduler.runDailyAlerts();
  }
}
