import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto';

/** ข้อมูล serial/lot ที่แนบมากับการเคลื่อนไหวสต๊อก */
class TrackingFieldsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'serial ทุกเครื่อง (สินค้า tracking_type = SERIAL) จำนวนต้องเท่ากับ qty',
    example: ['DK2026A00123', 'DK2026A00124'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  serials?: string[];
}

export class ReceiveStockDto extends TrackingFieldsDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ example: 10, description: 'จำนวน (หน่วยฐาน)' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  qty!: number;

  @ApiProperty({ example: 100, description: 'ทุนต่อหน่วยฐาน' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost!: number;

  @ApiPropertyOptional({ default: 'MANUAL' })
  @IsOptional()
  @IsString()
  refDocType?: string;

  @ApiProperty({ example: 'MN-2026-001', description: 'เลขเอกสารอ้างอิง' })
  @IsString()
  @MinLength(1)
  refDocId!: string;

  @ApiPropertyOptional({
    description: 'เลขล็อต (บังคับสำหรับสินค้า tracking_type = LOT เช่น ปูน สี)',
    example: 'TPI-2026-08-A',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lotNo?: string;

  @ApiPropertyOptional({ description: 'วันหมดอายุของล็อต', example: '2027-02-01' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class IssueStockDto extends TrackingFieldsDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ example: 5, description: 'จำนวน (หน่วยฐาน)' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({ default: 'MANUAL' })
  @IsOptional()
  @IsString()
  refDocType?: string;

  @ApiProperty({ example: 'MN-2026-002' })
  @IsString()
  @MinLength(1)
  refDocId!: string;

  @ApiPropertyOptional({
    description:
      'ล็อตที่จะจ่าย (บังคับสำหรับสินค้า LOT) — ดูล็อตแนะนำแบบ FEFO จาก GET /inventory/lots',
  })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({
    description: 'ลูกค้าที่ซื้อ — ใช้ผูกกับ serial เพื่อเช็คประกันตอนเคลม',
  })
  @IsOptional()
  @IsUUID()
  soldToPartnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class AdjustStockDto extends TrackingFieldsDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({
    example: 47,
    description: 'จำนวนที่นับได้จริง (หน่วยฐาน) — ระบบคำนวณส่วนต่างให้',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  actualQty!: number;

  @ApiProperty({ example: 'STK-2026-08-001', description: 'เลขรอบนับสต๊อก/เหตุผล' })
  @IsString()
  @MinLength(1)
  reason!: string;

  @ApiPropertyOptional({
    description: 'ทุนต่อหน่วยกรณีปรับเพิ่ม (ไม่ระบุ = ใช้ทุนเฉลี่ยปัจจุบัน)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ description: 'เลขล็อตกรณีปรับเพิ่มสินค้า LOT' })
  @IsOptional()
  @IsString()
  lotNo?: string;

  @ApiPropertyOptional({ description: 'ล็อตที่จะปรับลด (สินค้า LOT)' })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryLotsDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ description: 'ไม่ระบุ = รวมทุกคลัง' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'แสดงเฉพาะล็อตที่ยังมีของ',
  })
  @IsOptional()
  @Type(() => Boolean)
  availableOnly?: boolean;
}

export class ExpiringLotsDto {
  @ApiPropertyOptional({ default: 30, description: 'ล็อตที่จะหมดอายุภายในกี่วัน' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class QuerySerialsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: ['IN_STOCK', 'SOLD', 'CLAIMED', 'RETURNED'] })
  @IsOptional()
  @IsString()
  status?: string;
}

export class StockCardQueryDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class QueryMovementsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'กรองตามเอกสาร เช่น MANUAL' })
  @IsOptional()
  @IsString()
  refDocType?: string;
}

export class BalanceQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'ค้นจากรหัสหรือชื่อสินค้า' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'ซ่อนสินค้าที่ยอดเป็นศูนย์ (หน้างานปกติไม่อยากเห็น)',
  })
  @IsOptional()
  @IsString()
  hideZero?: string;
}
