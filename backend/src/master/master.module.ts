import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { PartnersController } from './partners/partners.controller';
import { PartnersService } from './partners/partners.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { UomsController } from './uoms/uoms.controller';
import { UomsService } from './uoms/uoms.service';
import { WarehousesController } from './warehouses/warehouses.controller';
import { WarehousesService } from './warehouses/warehouses.service';

@Module({
  imports: [InventoryModule],
  controllers: [
    UomsController,
    CategoriesController,
    WarehousesController,
    PartnersController,
    ProductsController,
  ],
  providers: [
    UomsService,
    CategoriesService,
    WarehousesService,
    PartnersService,
    ProductsService,
  ],
  exports: [ProductsService],
})
export class MasterModule {}
