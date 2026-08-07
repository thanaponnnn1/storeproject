import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-error';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePartnerDto,
  QueryPartnersDto,
  UpdatePartnerDto,
} from './partners.dto';

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryPartnersDto) {
    const where: Prisma.PartnerWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.partner.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.partner.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException('ไม่พบคู่ค้า');
    return partner;
  }

  async create(dto: CreatePartnerDto) {
    try {
      return await this.prisma.partner.create({ data: dto });
    } catch (e) {
      rethrowPrismaError(e, 'คู่ค้า');
    }
  }

  async update(id: string, dto: UpdatePartnerDto) {
    try {
      return await this.prisma.partner.update({ where: { id }, data: dto });
    } catch (e) {
      rethrowPrismaError(e, 'คู่ค้า');
    }
  }
}
