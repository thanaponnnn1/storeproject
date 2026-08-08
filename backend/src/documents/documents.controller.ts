import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PurchaseOrderStatus,
  QuotationStatus,
  SalesOrderStatus,
} from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeliveriesService } from './deliveries/deliveries.service';
import {
  ConvertQuotationDto,
  CreateDeliveryDto,
  CreateGoodsReceiptDto,
  CreateInvoiceDto,
  CreatePaymentDto,
  CreatePurchaseOrderDto,
  CreateQuotationDto,
  CreateSalesOrderDto,
  QueryDocsDto,
} from './documents.dto';
import { InvoicesService } from './invoices/invoices.service';
import { PaymentsService } from './payments/payments.service';
import { GoodsReceiptsService } from './purchases/goods-receipts.service';
import { PurchaseOrdersService } from './purchases/purchase-orders.service';
import { QuotationsService } from './quotations/quotations.service';
import { ReportsService } from './reports/reports.service';
import { SalesOrdersService } from './sales-orders/sales-orders.service';

@ApiTags('sales: quotations')
@ApiBearerAuth()
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'SALES')
  @ApiOperation({ summary: 'สร้างใบเสนอราคา (ราคาดึงตามระดับลูกค้าอัตโนมัติ)' })
  create(
    @Body() dto: CreateQuotationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub, user.role);
  }

  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  @ApiOperation({ summary: 'แก้ไขใบเสนอราคา (ได้เฉพาะฉบับร่าง)' })
  update(
    @Param('id') id: string,
    @Body() dto: CreateQuotationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.update(id, dto, user.sub, user.role);
  }

  @Patch(':id/submit')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  submit(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, QuotationStatus.SUBMITTED, user.sub);
  }

  @Patch(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'อนุมัติใบเสนอราคา (ผู้จัดการขึ้นไป)' })
  approve(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, QuotationStatus.APPROVED, user.sub);
  }

  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, QuotationStatus.CANCELLED, user.sub);
  }

  @Post(':id/convert')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  @ApiOperation({ summary: 'แปลงเป็นใบสั่งขาย (บรรทัดชี้กลับใบเสนอราคาต้นทาง)' })
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertQuotationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.convertToSalesOrder(id, dto, user.sub);
  }
}

@ApiTags('sales: sales-orders')
@ApiBearerAuth()
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'SALES')
  create(
    @Body() dto: CreateSalesOrderDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub, user.role);
  }

  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  update(
    @Param('id') id: string,
    @Body() dto: CreateSalesOrderDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.update(id, dto, user.sub, user.role);
  }

  @Patch(':id/confirm')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  @ApiOperation({ summary: 'ยืนยันใบสั่งขาย (พร้อมออกใบส่งของ)' })
  confirm(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, SalesOrderStatus.CONFIRMED, user.sub);
  }

  @Patch(':id/close')
  @Roles('ADMIN', 'MANAGER')
  close(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, SalesOrderStatus.CLOSED, user.sub);
  }

  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ยกเลิกใบสั่งขาย (ทำได้ก่อนเริ่มส่งของ)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, SalesOrderStatus.CANCELLED, user.sub);
  }
}

@ApiTags('sales: deliveries')
@ApiBearerAuth()
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly service: DeliveriesService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE', 'SALES')
  @ApiOperation({ summary: 'สร้างใบส่งของจากใบสั่งขาย (ส่งบางส่วนได้)' })
  create(
    @Body() dto: CreateDeliveryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id/confirm')
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({
    summary: 'ยืนยันใบส่งของ = ตัดสต๊อกจริง (post ISSUE ลง ledger ใน tx เดียว)',
  })
  confirm(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.confirm(id, user.sub);
  }

  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ยกเลิกใบส่งของ (ยืนยันแล้ว = สร้าง reversal คืนสต๊อก)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.cancel(id, user.sub);
  }
}

@ApiTags('sales: invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get('outstanding')
  @ApiOperation({ summary: 'ลูกหนี้ค้างชำระ (overdueOnly=true = เฉพาะเกินกำหนด)' })
  outstanding(
    @Query('overdueOnly', new ParseBoolPipe({ optional: true }))
    overdueOnly?: boolean,
  ) {
    return this.service.outstanding(overdueOnly ?? false);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'SALES')
  @ApiOperation({ summary: 'วางบิลจากใบส่งของ (รวมหลายใบได้)' })
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id/issue')
  @Roles('ADMIN', 'MANAGER', 'SALES')
  issue(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, InvoiceStatus.ISSUED, user.sub);
  }

  @Patch(':id/void')
  @Roles('ADMIN', 'MANAGER')
  void(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, InvoiceStatus.VOID, user.sub);
  }
}

@ApiTags('purchase: purchase-orders')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'สร้างใบสั่งซื้อ (ทุนกรอกเอง ไม่ดึงอัตโนมัติ)' })
  create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  update(
    @Param('id') id: string,
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Patch(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'อนุมัติใบสั่งซื้อ (ผู้จัดการขึ้นไป — เป็นการผูกพันเงิน)' })
  approve(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, PurchaseOrderStatus.APPROVED, user.sub);
  }

  @Patch(':id/close')
  @Roles('ADMIN', 'MANAGER')
  close(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, PurchaseOrderStatus.CLOSED, user.sub);
  }

  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.changeStatus(id, PurchaseOrderStatus.CANCELLED, user.sub);
  }
}

@ApiTags('purchase: goods-receipts')
@ApiBearerAuth()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly service: GoodsReceiptsService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'สร้างใบรับของจากใบสั่งซื้อ (รับบางส่วนได้)' })
  create(
    @Body() dto: CreateGoodsReceiptDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id/confirm')
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({
    summary: 'ยืนยันใบรับของ = ของเข้าสต๊อกจริง + สร้าง cost layer ใน tx เดียว',
  })
  confirm(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.confirm(id, user.sub);
  }

  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ยกเลิกใบรับของ (ยืนยันแล้ว = กลับรายการใน ledger)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.service.cancel(id, user.sub);
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('gross-profit')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({
    summary: 'กำไรขั้นต้น: รายได้จากใบแจ้งหนี้ − ต้นทุนจริงที่ออกจากคลัง',
  })
  grossProfit(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('partnerId') partnerId?: string,
  ) {
    return this.service.grossProfit({ from, to, partnerId });
  }

  @Get('stock-value')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({
    summary: 'มูลค่าสต๊อก ณ วันที่ (คำนวณจาก ledger — ย้อนดูวันไหนก็ได้)',
  })
  stockValue(
    @Query('asOf') asOf?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.service.stockValue({ asOf, warehouseId });
  }

  @Get('monthly-sales')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ยอดขายรายเดือน' })
  monthlySales(@Query('year') year?: string) {
    return this.service.monthlySales({ year: year ? Number(year) : undefined });
  }

  @Get('ar-aging')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ลูกหนี้ค้างชำระแยกช่วงอายุหนี้' })
  arAging() {
    return this.service.arAging();
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'สินค้าต่ำกว่าจุดสั่งซื้อ (ฝ่ายคลังดูได้)' })
  lowStock(@Query('warehouseId') warehouseId?: string) {
    return this.service.lowStock(warehouseId);
  }
}

@ApiTags('sales: payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  findAll(@Query() query: QueryDocsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'SALES')
  @ApiOperation({ summary: 'รับชำระเงิน (เงินก้อนเดียวตัดได้หลายใบแจ้งหนี้)' })
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.create(dto, user.sub);
  }
}
