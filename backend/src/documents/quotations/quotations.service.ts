import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, QuotationStatus, SalesOrderStatus } from '@prisma/client';
import type { RoleName } from '../../common/decorators/roles.decorator';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { PricingService } from '../core/pricing.service';
import { assertEditable, assertTransition } from '../core/state-machine';
import {
  ConvertQuotationDto,
  CreateQuotationDto,
  QueryDocsDto,
} from '../documents.dto';

const D = Prisma.Decimal;

const quotationInclude = {
  partner: { select: { code: true, name: true, priceLevel: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true } },
      productUnit: { include: { uom: { select: { code: true, name: true } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.QuotationInclude;

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly pricing: PricingService,
  ) {}

  async create(dto: CreateQuotationDto, userId: string, role: RoleName) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({
        where: { id: dto.partnerId },
      });
      if (!partner || !partner.isActive) {
        throw new NotFoundException('ไม่พบลูกค้า หรือลูกค้าถูกปิดใช้งาน');
      }

      const lines = await this.pricing.priceLines(
        tx,
        dto.lines,
        partner.priceLevel,
        role,
      );
      const vatRate = new D(dto.vatRate ?? 7);
      const totals = this.pricing.totals(lines, vatRate);

      return tx.quotation.create({
        data: {
          docNo: await this.docNumber.next(tx, 'QT'),
          partnerId: dto.partnerId,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          remark: dto.remark,
          vatRate,
          ...totals,
          createdBy: userId,
          lines: { create: lines },
        },
        include: quotationInclude,
      });
    });
  }

  async update(
    id: string,
    dto: CreateQuotationDto,
    userId: string,
    role: RoleName,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('ไม่พบใบเสนอราคา');
      assertEditable('QT', existing.status);

      const partner = await tx.partner.findUniqueOrThrow({
        where: { id: dto.partnerId },
      });
      const lines = await this.pricing.priceLines(
        tx,
        dto.lines,
        partner.priceLevel,
        role,
      );
      const vatRate = new D(dto.vatRate ?? 7);
      const totals = this.pricing.totals(lines, vatRate);

      // ฉบับร่างแก้ได้ทั้งใบ — ล้างบรรทัดเดิมแล้วเขียนใหม่ทั้งชุด
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          remark: dto.remark,
          vatRate,
          ...totals,
          lines: { create: lines },
        },
        include: quotationInclude,
      });
    });
  }

  async changeStatus(id: string, to: QuotationStatus, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({ where: { id } });
      if (!quotation) throw new NotFoundException('ไม่พบใบเสนอราคา');
      assertTransition('QT', quotation.status, to);

      return tx.quotation.update({
        where: { id },
        data: {
          status: to,
          ...(to === QuotationStatus.APPROVED
            ? { approvedBy: userId, approvedAt: new Date() }
            : {}),
        },
        include: quotationInclude,
      });
    });
  }

  /**
   * แปลงใบเสนอราคาที่อนุมัติแล้วเป็นใบสั่งขาย
   * บรรทัดของ SO ชี้กลับไปที่บรรทัดของ QT (sourceLineId) เป็นลูกโซ่เอกสาร
   */
  async convertToSalesOrder(
    id: string,
    dto: ConvertQuotationDto,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!quotation) throw new NotFoundException('ไม่พบใบเสนอราคา');
      if (quotation.status !== QuotationStatus.APPROVED) {
        throw new UnprocessableEntityException(
          `แปลงเป็นใบสั่งขายได้เฉพาะใบเสนอราคาที่อนุมัติแล้ว (สถานะปัจจุบัน: ${quotation.status})`,
        );
      }

      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });
      if (!warehouse || !warehouse.isActive) {
        throw new NotFoundException('ไม่พบคลังสินค้า');
      }

      const salesOrder = await tx.salesOrder.create({
        data: {
          docNo: await this.docNumber.next(tx, 'SO'),
          status: SalesOrderStatus.DRAFT,
          partnerId: quotation.partnerId,
          quotationId: quotation.id,
          warehouseId: dto.warehouseId,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          remark: quotation.remark,
          vatRate: quotation.vatRate,
          subtotal: quotation.subtotal,
          vatAmount: quotation.vatAmount,
          totalAmount: quotation.totalAmount,
          createdBy: userId,
          lines: {
            create: quotation.lines.map((line) => ({
              lineNo: line.lineNo,
              productId: line.productId,
              productUnitId: line.productUnitId,
              qty: line.qty,
              baseQty: line.baseQty,
              unitPrice: line.unitPrice,
              discount: line.discount,
              lineTotal: line.lineTotal,
              sourceLineId: line.id,
            })),
          },
        },
        include: {
          partner: { select: { code: true, name: true } },
          lines: { orderBy: { lineNo: 'asc' } },
        },
      });

      assertTransition('QT', quotation.status, QuotationStatus.CONVERTED);
      await tx.quotation.update({
        where: { id },
        data: { status: QuotationStatus.CONVERTED },
      });

      return salesOrder;
    });
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.QuotationWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.status ? { status: query.status as QuotationStatus } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        where,
        include: { partner: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.quotation.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: { ...quotationInclude, salesOrders: { select: { id: true, docNo: true, status: true } } },
    });
    if (!quotation) throw new NotFoundException('ไม่พบใบเสนอราคา');
    return quotation;
  }

  /** cron เฟส 6 เรียกใช้: ใบเสนอราคาที่เลยวันยืนราคาแล้ว → EXPIRED */
  async expireOverdue() {
    const result = await this.prisma.quotation.updateMany({
      where: {
        status: { in: [QuotationStatus.SUBMITTED, QuotationStatus.APPROVED] },
        validUntil: { lt: new Date() },
      },
      data: { status: QuotationStatus.EXPIRED },
    });
    return { expired: result.count };
  }
}
