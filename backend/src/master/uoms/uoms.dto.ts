import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUomDto {
  @ApiProperty({ example: 'BUNDLE', description: 'รหัสหน่วย (unique)' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'มัด' })
  @IsString()
  @MinLength(1)
  name!: string;
}

export class UpdateUomDto extends PartialType(CreateUomDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
