import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import {
  AdjustStockDto,
  BalanceQueryDto,
  ExpiringLotsDto,
  IssueStockDto,
  QueryLotsDto,
  QueryMovementsDto,
  QuerySerialsDto,
  ReceiveStockDto,
  StockCardQueryDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Post('receipts')
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'รับสินค้าเข้า (คิดทุนเฉลี่ยใหม่ใน tx เดียว)' })
  receive(@Body() dto: ReceiveStockDto, @CurrentUser() user: AccessTokenPayload) {
    return this.service.receive(dto, user.sub);
  }

  @Post('issues')
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'จ่ายสินค้าออก (กันติดลบ + lock กันแย่งสต๊อก)' })
  issue(@Body() dto: IssueStockDto, @CurrentUser() user: AccessTokenPayload) {
    return this.service.issue(dto, user.sub);
  }

  @Post('adjustments')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ปรับยอดตามการนับจริง (สร้าง ADJUST_IN/OUT อัตโนมัติ)' })
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: AccessTokenPayload) {
    return this.service.adjust(dto, user.sub);
  }

  @Post('movements/:id/reverse')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'กลับรายการ movement (ของเดิมยังอยู่ใน ledger)' })
  reverse(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.reverse(id, user.sub);
  }

  @Get('stock-card')
  @ApiOperation({ summary: 'Stock card: movement + running balance' })
  stockCard(@Query() query: StockCardQueryDto) {
    return this.service.stockCard(query);
  }

  @Get('movements')
  @ApiOperation({ summary: 'รายการ movement ทั้งหมด (แบ่งหน้า)' })
  movements(@Query() query: QueryMovementsDto) {
    return this.service.movements(query);
  }

  @Get('balances')
  @ApiOperation({ summary: 'ยอดคงเหลือปัจจุบัน (ค้นหา + แบ่งหน้า)' })
  balances(@Query() query: BalanceQueryDto) {
    return this.service.balances(query);
  }

  @Get('serials/:serial')
  @ApiOperation({
    summary:
      'ยิง serial → สินค้าอะไร ซื้อวันไหน ใครซื้อ ประกันเหลือกี่วัน (หน้าเคลม)',
  })
  findSerial(@Param('serial') serial: string) {
    return this.service.findSerial(serial);
  }

  @Get('serials')
  @ApiOperation({ summary: 'รายการ serial ทั้งหมด (กรองตามสินค้า/คลัง/สถานะ)' })
  serials(@Query() query: QuerySerialsDto) {
    return this.service.serials(query);
  }

  @Get('lots')
  @ApiOperation({
    summary: 'ล็อตพร้อมยอดคงเหลือ เรียงแบบ FEFO (ใกล้หมดอายุออกก่อน)',
  })
  lots(@Query() query: QueryLotsDto) {
    return this.service.lots(query);
  }

  @Get('lots/expiring')
  @ApiOperation({ summary: 'ล็อตที่จะหมดอายุภายใน N วัน (ใช้แจ้งเตือน/จัดโปรระบาย)' })
  expiringLots(@Query() query: ExpiringLotsDto) {
    return this.service.expiringLots(query);
  }

  @Get('cost-layers')
  @ApiOperation({
    summary: 'FIFO cost layers + ประวัติการกิน layer (ตรวจต้นทุนย้อนหลัง)',
  })
  costLayers(
    @Query('productId') productId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.service.costLayers(productId, warehouseId);
  }

  @Post('cost-layers/backfill')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'สร้าง layer ยอดยกมาให้สินค้า FIFO ที่ layer ไม่ครบ (ใช้ตอน migrate ข้อมูลเก่า)',
  })
  backfillLayers() {
    return this.service.backfillFifoOpeningLayers();
  }

  @Get('reconcile')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ตรวจกระทบยอด: cache vs SUM(ledger) — ต้อง clean เสมอ' })
  reconcile() {
    return this.service.reconcile();
  }
}
