import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { rethrowPrismaError } from '../../common/prisma-error';
import { CreateUomDto, UpdateUomDto } from './uoms.dto';

@Injectable()
export class UomsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(includeInactive: boolean) {
    return this.prisma.uom.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const uom = await this.prisma.uom.findUnique({ where: { id } });
    if (!uom) throw new NotFoundException('ไม่พบหน่วยนับ');
    return uom;
  }

  async create(dto: CreateUomDto) {
    try {
      return await this.prisma.uom.create({ data: dto });
    } catch (e) {
      rethrowPrismaError(e, 'หน่วยนับ');
    }
  }

  async update(id: string, dto: UpdateUomDto) {
    try {
      return await this.prisma.uom.update({ where: { id }, data: dto });
    } catch (e) {
      rethrowPrismaError(e, 'หน่วยนับ');
    }
  }
}
