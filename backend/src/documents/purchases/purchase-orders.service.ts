import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PartnerType, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import type { Tx } from '../../inventory/costing/costing.types';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { PricingService } from '../core/pricing.service';
import { assertEditable, assertTransition } from '../core/state-machine';
import { CreatePurchaseOrderDto, QueryDocsDto } from '../documents.dto';

const D = Prisma.Decimal;

const poInclude = {
  partner: { select: { code: true, name: true, creditTermDays: true } },
  warehouse: { select: { code: true, name: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true, trackingType: true } },
      productUnit: { include: { uom: { select: { code: true, name: true } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly pricing: PricingService,
  ) {}

  async create(dto: CreatePurchaseOrderDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.partner.findUnique({
        where: { id: dto.partnerId },
      });
      if (!supplier || !supplier.isActive) {
        throw new NotFoundException('ไม่พบซัพพลายเออร์');
      }
      if (
        supplier.type !== PartnerType.SUPPLIER &&
        supplier.type !== PartnerType.BOTH
      ) {
        throw new UnprocessableEntityException(
          `คู่ค้า ${supplier.name} ไม่ใช่ซัพพลายเออร์ — สั่งซื้อไม่ได้`,
        );
      }
      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });
      if (!warehouse || !warehouse.isActive) {
        throw new NotFoundException('ไม่พบคลังสินค้า');
      }

      const lines = await this.pricing.costLines(tx, dto.lines);
      const vatRate = new D(dto.vatRate ?? 7);
      const totals = this.pricing.totals(lines, vatRate);

      return tx.purchaseOrder.create({
        data: {
          docNo: await this.docNumber.next(tx, 'PO'),
          partnerId: dto.partnerId,
          warehouseId: dto.warehouseId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          remark: dto.remark,
          vatRate,
          ...totals,
          createdBy: userId,
          lines: {
            create: lines.map(({ unitPrice: _unitPrice, ...line }) => line),
          },
        },
        include: poInclude,
      });
    });
  }

  async update(id: string, dto: CreatePurchaseOrderDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
      assertEditable('PO', existing.status);

      const lines = await this.pricing.costLines(tx, dto.lines);
      const vatRate = new D(dto.vatRate ?? 7);
      const totals = this.pricing.totals(lines, vatRate);

      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          warehouseId: dto.warehouseId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          remark: dto.remark,
          vatRate,
          ...totals,
          lines: {
            create: lines.map(({ unitPrice: _unitPrice, ...line }) => line),
          },
        },
        include: poInclude,
      });
    });
  }

  async changeStatus(id: string, to: PurchaseOrderStatus, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
      assertTransition('PO', po.status, to);

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: to,
          ...(to === PurchaseOrderStatus.APPROVED && !po.approvedAt
            ? { approvedBy: userId, approvedAt: new Date() }
            : {}),
        },
        include: poInclude,
      });
    });
  }

  /** ปรับสถานะใบสั่งซื้อตามยอดที่รับจริง — เรียกทุกครั้งที่ยืนยัน/ยกเลิกใบรับของ */
  async syncReceiveStatus(tx: Tx, purchaseOrderId: string): Promise<void> {
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { lines: true },
    });
    if (
      po.status === PurchaseOrderStatus.CANCELLED ||
      po.status === PurchaseOrderStatus.CLOSED
    ) {
      return;
    }

    const anyReceived = po.lines.some((l) => l.qtyReceived.greaterThan(0));
    const allReceived = po.lines.every((l) =>
      l.qtyReceived.greaterThanOrEqualTo(l.baseQty),
    );

    const next = allReceived
      ? PurchaseOrderStatus.RECEIVED
      : anyReceived
        ? PurchaseOrderStatus.PARTIALLY_RECEIVED
        : PurchaseOrderStatus.APPROVED;

    if (next !== po.status) {
      assertTransition('PO', po.status, next);
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: next },
      });
    }
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.status ? { status: query.status as PurchaseOrderStatus } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { partner: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        ...poInclude,
        receipts: { select: { id: true, docNo: true, status: true, docDate: true } },
      },
    });
    if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    return po;
  }
}
