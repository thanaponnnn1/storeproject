import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import { PartnerType, PriceLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreatePartnerDto {
  @ApiProperty({ example: 'C-0001' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'ช่างสมชาย รับเหมาไฟฟ้า' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: PartnerType })
  @IsEnum(PartnerType)
  type!: PartnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ default: 0, description: 'เครดิตกี่วัน (0 = เงินสด)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  creditTermDays?: number;

  @ApiPropertyOptional({ enum: PriceLevel, default: PriceLevel.RETAIL })
  @IsOptional()
  @IsEnum(PriceLevel)
  priceLevel?: PriceLevel;
}

export class UpdatePartnerDto extends PartialType(CreatePartnerDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryPartnersDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'ค้นจาก code / ชื่อ / เบอร์โทร' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: PartnerType })
  @IsOptional()
  @IsEnum(PartnerType)
  type?: PartnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}
