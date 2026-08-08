import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

class QueryAuditDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองตามผู้ใช้' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'เช่น deliveries.confirm, quotations.approve' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'เช่น products, deliveries, invoices' })
  @IsOptional()
  @IsString()
  entityType?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ประวัติการใช้งานระบบ (ใคร ทำอะไร เมื่อไหร่)' })
  async findAll(@Query() query: QueryAuditDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  @Get('entity/:entityType/:entityId')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'ประวัติทั้งหมดของเอกสาร/ข้อมูลชิ้นหนึ่ง' })
  findForEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
