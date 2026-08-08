import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { CostingMethod, TrackingType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateProductUnitDto {
  @ApiProperty({ description: 'หน่วยขาย เช่น มัด, ม้วน, ลัง' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({
    example: 10,
    description: '1 หน่วยนี้ = กี่หน่วยฐาน (1 มัด = 10 เส้น)',
  })
  @IsNumber()
  @IsPositive()
  conversionFactor!: number;

  @ApiPropertyOptional({ description: 'ราคาขายต่อหน่วยนี้ (ปลีก)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'STL-RB9' })
  @IsString()
  @MinLength(1)
  sku!: string;

  @ApiProperty({ example: 'เหล็กเส้นกลม RB9 SR24' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 'TATA' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'RB9' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ description: 'หน่วยฐานที่ใช้เก็บสต๊อก' })
  @IsUUID()
  baseUomId!: string;

  @ApiPropertyOptional({ enum: TrackingType, default: TrackingType.NONE })
  @IsOptional()
  @IsEnum(TrackingType)
  trackingType?: TrackingType;

  @ApiPropertyOptional({ enum: CostingMethod, default: CostingMethod.AVG })
  @IsOptional()
  @IsEnum(CostingMethod)
  costingMethod?: CostingMethod;

  @ApiPropertyOptional({ default: 0, description: 'ประกันกี่เดือนนับจากวันขาย' })
  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @ApiPropertyOptional({ default: 0, description: 'ราคาปลีก (ต่อหน่วยฐาน)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceRetail?: number;

  @ApiPropertyOptional({ default: 0, description: 'ราคาช่าง' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceContractor?: number;

  @ApiPropertyOptional({ default: 0, description: 'ราคาโครงการ' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceProject?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({
    description: 'public_id ของรูปบน Cloudinary (ได้จากการอัปโหลดตรงที่ Cloudinary)',
    example: 'products/abc123',
  })
  @IsOptional()
  @IsString()
  imagePublicId?: string;

  @ApiPropertyOptional({
    type: [CreateProductUnitDto],
    description: 'หน่วยขายเพิ่มเติมนอกจากหน่วยฐาน',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductUnitDto)
  units?: CreateProductUnitDto[];
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['units'] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryProductsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'ค้นจาก sku / ชื่อ / ยี่ห้อ / รุ่น' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: TrackingType })
  @IsOptional()
  @IsEnum(TrackingType)
  trackingType?: TrackingType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateBarcodeDto {
  @ApiPropertyOptional({
    description:
      'barcode จากโรงงาน (EAN-13/Code128) — ไม่ส่ง = ให้ระบบ generate QR ภายใน',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  barcode?: string;

  @ApiPropertyOptional({
    description: 'ผูกกับหน่วยขายไหน (ไม่ส่ง = หน่วยฐาน)',
  })
  @IsOptional()
  @IsUUID()
  productUnitId?: string;
}

export class ConvertQtyDto {
  @ApiProperty({ description: 'หน่วยที่ต้องการแปลง' })
  @IsUUID()
  uomId!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @IsPositive()
  qty!: number;
}
