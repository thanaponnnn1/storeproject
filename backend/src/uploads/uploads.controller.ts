import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { UploadsService } from './uploads.service';

class SignatureDto {
  @ApiPropertyOptional({
    enum: ['products', 'partners', 'documents'],
    default: 'products',
  })
  @IsOptional()
  @IsIn(['products', 'partners', 'documents'])
  folder?: 'products' | 'partners' | 'documents';
}

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post('signature')
  @Roles('ADMIN', 'MANAGER', 'WAREHOUSE', 'SALES')
  @ApiOperation({
    summary:
      'ขอลายเซ็นอัปโหลดรูป — หน้าบ้านเอาไปยิงตรงที่ Cloudinary (ไฟล์ไม่ผ่านเซิร์ฟเวอร์เรา)',
  })
  signature(@Body() dto: SignatureDto) {
    return this.service.createSignature(dto.folder ?? 'products');
  }
}
