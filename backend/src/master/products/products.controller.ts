import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ConvertQtyDto,
  CreateBarcodeDto,
  CreateProductDto,
  CreateProductUnitDto,
  QueryProductsDto,
  UpdateProductDto,
} from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('master: products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'ค้นหาสินค้า (แบ่งหน้า)' })
  findAll(@Query() query: QueryProductsDto) {
    return this.service.findAll(query);
  }

  @Get('by-barcode/:code')
  @ApiOperation({
    summary: 'ยิง barcode/QR → สินค้า + หน่วยของ barcode + ตัวคูณ (หน้างานใช้)',
  })
  findByBarcode(@Param('code') code: string) {
    return this.service.findByBarcode(code);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'สร้างสินค้า (แนบหน่วยขายเพิ่มเติมได้)' })
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/units')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'เพิ่มหน่วยขาย (1 มัด = 10 เส้น)' })
  addUnit(@Param('id') id: string, @Body() dto: CreateProductUnitDto) {
    return this.service.addUnit(id, dto);
  }

  @Post(':id/barcodes')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({
    summary: 'เพิ่ม barcode — ไม่ส่ง barcode = generate QR ภายใน (INT:SKU:UOM)',
  })
  addBarcode(@Param('id') id: string, @Body() dto: CreateBarcodeDto) {
    return this.service.addBarcode(id, dto);
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'แปลงจำนวนหน่วยขาย → หน่วยฐาน (2 มัด → 20 เส้น)' })
  convert(@Param('id') id: string, @Body() dto: ConvertQtyDto) {
    return this.service.convert(id, dto);
  }
}
