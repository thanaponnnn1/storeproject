import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeliveryStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import type { Tx } from '../../inventory/costing/costing.types';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { PricingService } from '../core/pricing.service';
import { assertTransition } from '../core/state-machine';
import { CreateInvoiceDto, QueryDocsDto } from '../documents.dto';

const D = Prisma.Decimal;

const invoiceInclude = {
  partner: { select: { code: true, name: true, creditTermDays: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true } },
      productUnit: { include: { uom: { select: { code: true } } } },
      deliveryOrder: { select: { docNo: true } },
    },
    orderBy: { lineNo: 'asc' },
  },
  allocations: {
    include: { payment: { select: { docNo: true, paymentDate: true, method: true } } },
  },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly pricing: PricingService,
  ) {}

  /** วางบิลจากใบส่งของ (รวมหลายใบของลูกค้ารายเดียวกันได้) */
  async create(dto: CreateInvoiceDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deliveries = await tx.deliveryOrder.findMany({
        where: { id: { in: dto.deliveryOrderIds } },
        include: { lines: true, salesOrder: true },
      });
      if (deliveries.length !== dto.deliveryOrderIds.length) {
        throw new NotFoundException('มีใบส่งของบางใบที่ไม่พบในระบบ');
      }

      const partnerIds = new Set(deliveries.map((d) => d.partnerId));
      if (partnerIds.size > 1) {
        throw new BadRequestException(
          'รวมวางบิลได้เฉพาะใบส่งของของลูกค้ารายเดียวกัน',
        );
      }
      for (const delivery of deliveries) {
        if (delivery.status !== DeliveryStatus.CONFIRMED) {
          throw new UnprocessableEntityException(
            `ใบส่งของ ${delivery.docNo} ยังไม่ได้ยืนยัน (สถานะ ${delivery.status}) วางบิลไม่ได้`,
          );
        }
        const already = await tx.invoiceLine.count({
          where: {
            deliveryOrderId: delivery.id,
            invoice: { status: { not: InvoiceStatus.VOID } },
          },
        });
        if (already > 0) {
          throw new UnprocessableEntityException(
            `ใบส่งของ ${delivery.docNo} ถูกวางบิลไปแล้ว`,
          );
        }
      }

      const partner = await tx.partner.findUniqueOrThrow({
        where: { id: deliveries[0]!.partnerId },
      });
      const salesOrder = deliveries[0]!.salesOrder;

      let lineNo = 0;
      const lines = deliveries.flatMap((delivery) =>
        delivery.lines.map((line) => ({
          lineNo: ++lineNo,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          baseQty: line.baseQty,
          unitPrice: line.unitPrice,
          discount: line.discount,
          lineTotal: line.lineTotal,
          deliveryOrderId: delivery.id,
          sourceLineId: line.id,
          soLineId: line.sourceLineId,
        })),
      );

      const vatRate = salesOrder.vatRate;
      const totals = this.pricing.totals(lines, vatRate);
      const dueDate = dto.dueDate
        ? new Date(dto.dueDate)
        : new Date(Date.now() + partner.creditTermDays * 86_400_000);

      const invoice = await tx.invoice.create({
        data: {
          docNo: await this.docNumber.next(tx, 'INV'),
          partnerId: partner.id,
          salesOrderId: salesOrder.id,
          dueDate,
          remark: dto.remark,
          vatRate,
          ...totals,
          createdBy: userId,
          lines: { create: lines },
        },
        include: invoiceInclude,
      });

      // อัปเดตยอดวางบิลสะสมบนใบสั่งขาย
      for (const line of lines) {
        if (!line.soLineId) continue;
        await tx.salesOrderLine.update({
          where: { id: line.soLineId },
          data: { qtyInvoiced: { increment: line.baseQty } },
        });
      }

      return invoice;
    });
  }

  async changeStatus(id: string, to: InvoiceStatus, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('ไม่พบใบแจ้งหนี้');
      assertTransition('INV', invoice.status, to);

      if (to === InvoiceStatus.VOID && invoice.amountPaid.greaterThan(0)) {
        throw new UnprocessableEntityException(
          'ใบแจ้งหนี้นี้มีการรับชำระแล้ว — ต้องยกเลิกการรับชำระก่อน',
        );
      }

      return tx.invoice.update({
        where: { id },
        data: {
          status: to,
          ...(to === InvoiceStatus.ISSUED && !invoice.issuedAt
            ? { issuedBy: userId, issuedAt: new Date() }
            : {}),
        },
        include: invoiceInclude,
      });
    });
  }

  /** ปรับสถานะตามยอดที่ชำระแล้ว — เรียกจากการรับชำระเงิน */
  async syncPaymentStatus(tx: Tx, invoiceId: string): Promise<void> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    if (invoice.status === InvoiceStatus.VOID) return;

    const next = invoice.amountPaid.greaterThanOrEqualTo(invoice.totalAmount)
      ? InvoiceStatus.PAID
      : invoice.amountPaid.greaterThan(0)
        ? InvoiceStatus.PARTIALLY_PAID
        : InvoiceStatus.ISSUED;

    if (next !== invoice.status) {
      assertTransition('INV', invoice.status, next);
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: next } });
    }
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.status ? { status: query.status as InvoiceStatus } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: { partner: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('ไม่พบใบแจ้งหนี้');
    return {
      ...invoice,
      amountDue: invoice.totalAmount.sub(invoice.amountPaid),
    };
  }

  /** ลูกหนี้ค้างชำระ — เกินกำหนดชำระแล้วยังไม่ปิดยอด */
  async outstanding(overdueOnly = false) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: {
          in: [
            InvoiceStatus.ISSUED,
            InvoiceStatus.PARTIALLY_PAID,
          ],
        },
        ...(overdueOnly ? { dueDate: { lt: new Date() } } : {}),
      },
      include: { partner: { select: { code: true, name: true, phone: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const now = Date.now();
    return invoices.map((inv) => ({
      id: inv.id,
      docNo: inv.docNo,
      partner: inv.partner,
      dueDate: inv.dueDate,
      totalAmount: inv.totalAmount,
      amountPaid: inv.amountPaid,
      amountDue: inv.totalAmount.sub(inv.amountPaid),
      daysOverdue: Math.max(
        0,
        Math.floor((now - inv.dueDate.getTime()) / 86_400_000),
      ),
    }));
  }
}
