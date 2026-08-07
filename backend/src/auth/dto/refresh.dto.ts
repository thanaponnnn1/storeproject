import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'refresh token ที่ได้จาก login/refresh ครั้งก่อน' })
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}
