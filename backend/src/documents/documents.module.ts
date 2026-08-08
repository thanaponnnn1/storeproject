import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { DocNumberService } from './core/doc-number.service';
import { PricingService } from './core/pricing.service';
import { DeliveriesService } from './deliveries/deliveries.service';
import {
  DeliveriesController,
  GoodsReceiptsController,
  InvoicesController,
  PaymentsController,
  PurchaseOrdersController,
  QuotationsController,
  ReportsController,
  SalesOrdersController,
} from './documents.controller';
import { InvoicesService } from './invoices/invoices.service';
import { PaymentsService } from './payments/payments.service';
import { GoodsReceiptsService } from './purchases/goods-receipts.service';
import { PurchaseOrdersService } from './purchases/purchase-orders.service';
import { QuotationsService } from './quotations/quotations.service';
import { ReportsService } from './reports/reports.service';
import { SalesOrdersService } from './sales-orders/sales-orders.service';

@Module({
  imports: [InventoryModule],
  controllers: [
    QuotationsController,
    SalesOrdersController,
    DeliveriesController,
    InvoicesController,
    PaymentsController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    ReportsController,
  ],
  providers: [
    DocNumberService,
    PricingService,
    QuotationsService,
    SalesOrdersService,
    DeliveriesService,
    InvoicesService,
    PaymentsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    ReportsService,
  ],
  exports: [QuotationsService, InvoicesService, ReportsService],
})
export class DocumentsModule {}
