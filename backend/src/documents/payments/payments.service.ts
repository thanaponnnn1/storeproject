import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { CreatePaymentDto, QueryDocsDto } from '../documents.dto';
import { InvoicesService } from '../invoices/invoices.service';

const D = Prisma.Decimal;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly invoices: InvoicesService,
  ) {}

  /**
   * รับชำระเงิน — เงินหนึ่งก้อนตัดได้หลายใบแจ้งหนี้
   * ยอดที่ตัดรวมกันต้องเท่ากับเงินที่รับมาเป๊ะ และห้ามตัดเกินยอดค้างของแต่ละใบ
   */
  async create(dto: CreatePaymentDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const amount = new D(dto.amount);
      const allocated = dto.allocations.reduce(
        (sum, a) => sum.add(new D(a.amount)),
        new D(0),
      );
      if (!allocated.equals(amount)) {
        throw new BadRequestException(
          `ยอดที่ตัดใบแจ้งหนี้รวม ${allocated.toString()} ไม่เท่ากับเงินที่รับ ${amount.toString()}`,
        );
      }

      const invoiceIds = dto.allocations.map((a) => a.invoiceId);
      if (new Set(invoiceIds).size !== invoiceIds.length) {
        throw new BadRequestException(
          'มีใบแจ้งหนี้ซ้ำในรายการตัดชำระ — ให้รวมเป็นบรรทัดเดียว',
        );
      }

      const payment = await tx.payment.create({
        data: {
          docNo: await this.docNumber.next(tx, 'PMT'),
          partnerId: dto.partnerId,
          method: dto.method,
          amount,
          reference: dto.reference,
          remark: dto.remark,
          createdBy: userId,
        },
      });

      for (const alloc of dto.allocations) {
        const invoice = await tx.invoice.findUnique({
          where: { id: alloc.invoiceId },
        });
        if (!invoice) {
          throw new NotFoundException(`ไม่พบใบแจ้งหนี้ ${alloc.invoiceId}`);
        }
        if (invoice.partnerId !== dto.partnerId) {
          throw new BadRequestException(
            `ใบแจ้งหนี้ ${invoice.docNo} เป็นของลูกค้ารายอื่น`,
          );
        }
        if (
          invoice.status === InvoiceStatus.DRAFT ||
          invoice.status === InvoiceStatus.VOID
        ) {
          throw new UnprocessableEntityException(
            `ใบแจ้งหนี้ ${invoice.docNo} สถานะ ${invoice.status} รับชำระไม่ได้`,
          );
        }

        const allocAmount = new D(alloc.amount);
        const due = invoice.totalAmount.sub(invoice.amountPaid);
        if (allocAmount.greaterThan(due)) {
          throw new UnprocessableEntityException(
            `ใบแจ้งหนี้ ${invoice.docNo} ค้างอยู่ ${due.toString()} แต่ตัดชำระ ${allocAmount.toString()} (ห้ามรับเกินยอดหนี้)`,
          );
        }

        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: allocAmount,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { amountPaid: { increment: allocAmount } },
        });
        await this.invoices.syncPaymentStatus(tx, invoice.id);
      }

      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: {
          partner: { select: { code: true, name: true } },
          allocations: {
            include: {
              invoice: {
                select: {
                  docNo: true,
                  status: true,
                  totalAmount: true,
                  amountPaid: true,
                },
              },
            },
          },
        },
      });
    });
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.PaymentWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: {
          partner: { select: { code: true, name: true } },
          allocations: { include: { invoice: { select: { docNo: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        partner: { select: { code: true, name: true } },
        allocations: { include: { invoice: true } },
      },
    });
    if (!payment) throw new NotFoundException('ไม่พบใบรับชำระ');
    return payment;
  }
}
