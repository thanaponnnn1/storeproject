import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { rethrowPrismaError } from '../../common/prisma-error';
import { CreateWarehouseDto, UpdateWarehouseDto } from './warehouses.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(includeInactive: boolean) {
    return this.prisma.warehouse.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
    });
    if (!warehouse) throw new NotFoundException('ไม่พบคลังสินค้า');
    return warehouse;
  }

  async create(dto: CreateWarehouseDto) {
    try {
      return await this.prisma.warehouse.create({ data: dto });
    } catch (e) {
      rethrowPrismaError(e, 'คลังสินค้า');
    }
  }

  async update(id: string, dto: UpdateWarehouseDto) {
    try {
      return await this.prisma.warehouse.update({ where: { id }, data: dto });
    } catch (e) {
      rethrowPrismaError(e, 'คลังสินค้า');
    }
  }
}
