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
  IssueStockDto,
  QueryMovementsDto,
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
  @ApiOperation({ summary: 'ยอดคงเหลือปัจจุบัน (จาก cache)' })
  balances(
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.service.balances(productId, warehouseId);
  }

  @Get('reconcile')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ตรวจกระทบยอด: cache vs SUM(ledger) — ต้อง clean เสมอ' })
  reconcile() {
    return this.service.reconcile();
  }
}
