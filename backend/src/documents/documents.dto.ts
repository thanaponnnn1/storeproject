import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto';

export class DocLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ description: 'หน่วยขาย (ไม่ระบุ = หน่วยฐาน)' })
  @IsOptional()
  @IsUUID()
  productUnitId?: string;

  @ApiProperty({ example: 2, description: 'จำนวนในหน่วยที่ขาย' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({
    description: 'ราคาต่อหน่วย — ไม่ส่ง = ใช้ราคาตามระดับลูกค้า (ส่งเองต้องมีสิทธิ์)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ default: 0, description: 'ส่วนลดเป็นบาทต่อบรรทัด' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
}

export class CreateQuotationDto {
  @ApiProperty()
  @IsUUID()
  partnerId!: string;

  @ApiPropertyOptional({ description: 'ยืนราคาถึงวันที่' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  vatRate?: number;

  @ApiProperty({ type: [DocLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DocLineDto)
  lines!: DocLineDto[];
}

export class ConvertQuotationDto {
  @ApiProperty({ description: 'คลังที่จะจ่ายของ' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}

export class CreateSalesOrderDto extends CreateQuotationDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}

export class DeliveryLineDto {
  @ApiProperty({ description: 'บรรทัดของใบสั่งขายที่จะส่ง' })
  @IsUUID()
  soLineId!: string;

  @ApiProperty({ example: 6, description: 'จำนวนที่ส่งรอบนี้ (หน่วยเดียวกับใบสั่งขาย)' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'serial ที่จะส่ง (สินค้า SERIAL) จำนวนต้องเท่ากับจำนวนหน่วยฐาน',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  @ApiPropertyOptional({ description: 'ล็อตที่จะจ่าย (สินค้า LOT) — ดู FEFO จาก /inventory/lots' })
  @IsOptional()
  @IsUUID()
  lotId?: string;
}

export class CreateDeliveryDto {
  @ApiProperty()
  @IsUUID()
  salesOrderId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({ type: [DeliveryLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineDto)
  lines!: DeliveryLineDto[];
}

export class CreateInvoiceDto {
  @ApiProperty({
    type: [String],
    description: 'ใบส่งของที่จะรวมวางบิล (ต้อง confirm แล้ว และเป็นลูกค้ารายเดียวกัน)',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  deliveryOrderIds!: string[];

  @ApiPropertyOptional({
    description: 'ครบกำหนดชำระ — ไม่ระบุ = คิดจากเครดิตของลูกค้า',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;
}

export class PaymentAllocationDto {
  @ApiProperty()
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ example: 3000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  partnerId!: string;

  @ApiProperty({ example: 5000, description: 'ยอดเงินที่รับมา' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ description: 'เลขที่เช็ค / อ้างอิงการโอน' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({
    type: [PaymentAllocationDto],
    description: 'ตัดใบแจ้งหนี้ใบไหนบ้าง — ผลรวมต้องเท่ากับยอดเงิน',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations!: PaymentAllocationDto[];
}

export class PurchaseLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ description: 'หน่วยที่ซื้อ (ไม่ระบุ = หน่วยฐาน)' })
  @IsOptional()
  @IsUUID()
  productUnitId?: string;

  @ApiProperty({ example: 50 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  qty!: number;

  @ApiProperty({ example: 45, description: 'ทุนต่อหน่วยที่ซัพพลายเออร์เสนอ' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: 'ซัพพลายเออร์' })
  @IsUUID()
  partnerId!: string;

  @ApiProperty({ description: 'คลังที่จะรับของเข้า' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ description: 'กำหนดรับของ' })
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ default: 7 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  vatRate?: number;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class ReceiptLineDto {
  @ApiProperty({ description: 'บรรทัดของใบสั่งซื้อที่รับของ' })
  @IsUUID()
  poLineId!: string;

  @ApiProperty({ example: 30, description: 'จำนวนที่รับรอบนี้ (หน่วยเดียวกับใบสั่งซื้อ)' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({
    description: 'ทุนจริงที่รับ (ไม่ระบุ = ใช้ทุนตามใบสั่งซื้อ) — ของขึ้นราคาก็บันทึกได้',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'serial ทุกเครื่อง (สินค้า SERIAL) — จำนวนต้องเท่ากับหน่วยฐาน',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  @ApiPropertyOptional({ description: 'เลขล็อต (สินค้า LOT)' })
  @IsOptional()
  @IsString()
  lotNo?: string;

  @ApiPropertyOptional({ description: 'วันหมดอายุของล็อต' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty()
  @IsUUID()
  purchaseOrderId!: string;

  @ApiPropertyOptional({ description: 'เลขที่ใบส่งของของซัพพลายเออร์' })
  @IsOptional()
  @IsString()
  supplierRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({ type: [ReceiptLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

export class QueryDocsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'ค้นจากเลขที่เอกสาร' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;
}
