import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness — แอปยังหายใจอยู่ไหม' })
  healthz() {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  @ApiOperation({ summary: 'Readiness — ต่อ DB ได้จริงไหม' })
  async readyz() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  }
}
