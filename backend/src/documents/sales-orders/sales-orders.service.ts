import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import type { RoleName } from '../../common/decorators/roles.decorator';
import { paginate } from '../../common/dto/pagination.dto';
import type { Tx } from '../../inventory/costing/costing.types';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { PricingService } from '../core/pricing.service';
import { assertEditable, assertTransition } from '../core/state-machine';
import { CreateSalesOrderDto, QueryDocsDto } from '../documents.dto';

const D = Prisma.Decimal;

const soInclude = {
  partner: { select: { code: true, name: true, priceLevel: true, creditTermDays: true } },
  warehouse: { select: { code: true, name: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true, trackingType: true } },
      productUnit: { include: { uom: { select: { code: true, name: true } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.SalesOrderInclude;

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly pricing: PricingService,
  ) {}

  async create(dto: CreateSalesOrderDto, userId: string, role: RoleName) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({
        where: { id: dto.partnerId },
      });
      if (!partner || !partner.isActive) {
        throw new NotFoundException('ไม่พบลูกค้า');
      }
      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });
      if (!warehouse || !warehouse.isActive) {
        throw new NotFoundException('ไม่พบคลังสินค้า');
      }

      const lines = await this.pricing.priceLines(
        tx,
        dto.lines,
        partner.priceLevel,
        role,
      );
      const vatRate = new D(dto.vatRate ?? 7);
      const totals = this.pricing.totals(lines, vatRate);

      return tx.salesOrder.create({
        data: {
          docNo: await this.docNumber.next(tx, 'SO'),
          partnerId: dto.partnerId,
          warehouseId: dto.warehouseId,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          remark: dto.remark,
          vatRate,
          ...totals,
          createdBy: userId,
          lines: { create: lines },
        },
        include: soInclude,
      });
    });
  }

  async update(
    id: string,
    dto: CreateSalesOrderDto,
    userId: string,
    role: RoleName,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('ไม่พบใบสั่งขาย');
      assertEditable('SO', existing.status);

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

      await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
      return tx.salesOrder.update({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          warehouseId: dto.warehouseId,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          remark: dto.remark,
          vatRate,
          ...totals,
          lines: { create: lines },
        },
        include: soInclude,
      });
    });
  }

  async changeStatus(id: string, to: SalesOrderStatus, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUnique({ where: { id } });
      if (!so) throw new NotFoundException('ไม่พบใบสั่งขาย');
      assertTransition('SO', so.status, to);

      return tx.salesOrder.update({
        where: { id },
        data: {
          status: to,
          ...(to === SalesOrderStatus.CONFIRMED && !so.confirmedAt
            ? { confirmedBy: userId, confirmedAt: new Date() }
            : {}),
        },
        include: soInclude,
      });
    });
  }

  /**
   * ปรับสถานะใบสั่งขายตามยอดที่ส่งจริง — เรียกทุกครั้งที่ยืนยัน/ยกเลิกใบส่งของ
   * ส่งครบทุกบรรทัด = DELIVERED, ส่งบางส่วน = PARTIALLY_DELIVERED, ยังไม่ส่ง = CONFIRMED
   */
  async syncDeliveryStatus(tx: Tx, salesOrderId: string): Promise<void> {
    const so = await tx.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      include: { lines: true },
    });
    if (
      so.status === SalesOrderStatus.CANCELLED ||
      so.status === SalesOrderStatus.CLOSED
    ) {
      return;
    }

    const anyDelivered = so.lines.some((l) => l.qtyDelivered.greaterThan(0));
    const allDelivered = so.lines.every((l) =>
      l.qtyDelivered.greaterThanOrEqualTo(l.baseQty),
    );

    const next = allDelivered
      ? SalesOrderStatus.DELIVERED
      : anyDelivered
        ? SalesOrderStatus.PARTIALLY_DELIVERED
        : SalesOrderStatus.CONFIRMED;

    if (next !== so.status) {
      assertTransition('SO', so.status, next);
      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: next },
      });
    }
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.SalesOrderWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.status ? { status: query.status as SalesOrderStatus } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where,
        include: { partner: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const so = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        ...soInclude,
        quotation: { select: { id: true, docNo: true } },
        deliveries: { select: { id: true, docNo: true, status: true, docDate: true } },
        invoices: { select: { id: true, docNo: true, status: true, totalAmount: true } },
      },
    });
    if (!so) throw new NotFoundException('ไม่พบใบสั่งขาย');
    return so;
  }
}
