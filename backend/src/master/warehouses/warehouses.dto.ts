import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @ApiProperty({ example: 'WH-MAIN' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'คลังหลัก' })
  @IsString()
  @MinLength(1)
  name!: string;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
