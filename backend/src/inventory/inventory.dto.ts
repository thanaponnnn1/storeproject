import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto';

export class ReceiveStockDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class IssueStockDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class AdjustStockDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
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

export class BalanceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'เฉพาะตัวที่ต่ำกว่า min_stock' })
  @IsOptional()
  @Type(() => Boolean)
  belowMinOnly?: boolean;
}
