import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const D = Prisma.Decimal;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * มูลค่าสต๊อก ณ วันที่ใดก็ได้ — คำนวณจาก ledger ตรง ๆ ไม่ใช่จาก cache
   *
   * ผลรวม totalCost ของ movement ทั้งหมดถึงวันนั้น = มูลค่าคงเหลือ ณ วันนั้นพอดี
   * (รับเข้าเป็นบวก จ่ายออกเป็นลบตามทุนจริงที่ออก) จึงย้อนดูวันไหนก็ได้
   */
  async stockValue(params: { asOf?: string; warehouseId?: string }) {
    const asOf = params.asOf ? new Date(params.asOf) : new Date();

    const grouped = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'warehouseId'],
      where: {
        createdAt: { lte: asOf },
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      },
      _sum: { qty: true, totalCost: true },
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: {
        id: true,
        sku: true,
        name: true,
        costingMethod: true,
        baseUom: { select: { code: true } },
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    let totalValue = new D(0);
    const items = grouped
      .map((row) => {
        const qty = row._sum.qty ?? new D(0);
        const value = row._sum.totalCost ?? new D(0);
        const product = productById.get(row.productId);
        totalValue = totalValue.add(value);
        return {
          productId: row.productId,
          sku: product?.sku ?? '',
          name: product?.name ?? '',
          uom: product?.baseUom.code ?? '',
          costingMethod: product?.costingMethod,
          warehouseId: row.warehouseId,
          qtyOnHand: qty,
          value,
          avgCost: qty.isZero() ? new D(0) : value.div(qty).toDecimalPlaces(4),
        };
      })
      .filter((i) => !i.qtyOnHand.isZero() || !i.value.isZero())
      .sort((a, b) => b.value.comparedTo(a.value));

    return { asOf, totalValue, itemCount: items.length, items };
  }

  /** ยอดขายรายเดือน (จากใบแจ้งหนี้ที่ไม่ถูกยกเลิก) */
  async monthlySales(params: { year?: number }) {
    const year = params.year ?? new Date().getFullYear();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { not: InvoiceStatus.VOID },
        docDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      select: {
        docDate: true,
        subtotal: true,
        vatAmount: true,
        totalAmount: true,
        amountPaid: true,
      },
    });

    const months = new Map<
      number,
      {
        month: number;
        invoiceCount: number;
        subtotal: Prisma.Decimal;
        vat: Prisma.Decimal;
        total: Prisma.Decimal;
        paid: Prisma.Decimal;
      }
    >();
    for (const inv of invoices) {
      const m = inv.docDate.getMonth() + 1;
      const acc = months.get(m) ?? {
        month: m,
        invoiceCount: 0,
        subtotal: new D(0),
        vat: new D(0),
        total: new D(0),
        paid: new D(0),
      };
      acc.invoiceCount += 1;
      acc.subtotal = acc.subtotal.add(inv.subtotal);
      acc.vat = acc.vat.add(inv.vatAmount);
      acc.total = acc.total.add(inv.totalAmount);
      acc.paid = acc.paid.add(inv.amountPaid);
      months.set(m, acc);
    }

    const rows = [...months.values()].sort((a, b) => a.month - b.month);
    return {
      year,
      months: rows,
      yearTotal: rows.reduce((sum, r) => sum.add(r.total), new D(0)),
    };
  }

  /** ลูกหนี้ค้างชำระแยกช่วงอายุหนี้ (aging) */
  async arAging() {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
      },
      include: { partner: { select: { code: true, name: true, phone: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const now = Date.now();
    const buckets = {
      notDue: new D(0),
      d1to30: new D(0),
      d31to60: new D(0),
      d61to90: new D(0),
      over90: new D(0),
    };

    const items = invoices.map((inv) => {
      const due = inv.totalAmount.sub(inv.amountPaid);
      const daysOverdue = Math.floor(
        (now - inv.dueDate.getTime()) / 86_400_000,
      );
      const bucket =
        daysOverdue <= 0
          ? 'notDue'
          : daysOverdue <= 30
            ? 'd1to30'
            : daysOverdue <= 60
              ? 'd31to60'
              : daysOverdue <= 90
                ? 'd61to90'
                : 'over90';
      buckets[bucket] = buckets[bucket].add(due);
      return {
        invoiceId: inv.id,
        docNo: inv.docNo,
        partner: inv.partner,
        dueDate: inv.dueDate,
        amountDue: due,
        daysOverdue: Math.max(0, daysOverdue),
        bucket,
      };
    });

    return {
      buckets,
      totalOutstanding: Object.values(buckets).reduce(
        (sum, v) => sum.add(v),
        new D(0),
      ),
      items,
    };
  }

  /** สินค้าที่ยอดต่ำกว่าจุดสั่งซื้อ — ใช้เตือนให้สั่งของ */
  async lowStock(warehouseId?: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: warehouseId ? { warehouseId } : {},
      include: {
        product: {
          select: {
            sku: true,
            name: true,
            minStock: true,
            isActive: true,
            baseUom: { select: { code: true } },
          },
        },
        warehouse: { select: { code: true, name: true } },
      },
    });

    return balances
      .filter(
        (b) =>
          b.product.isActive &&
          b.product.minStock.greaterThan(0) &&
          b.qtyOnHand.lessThan(b.product.minStock),
      )
      .map((b) => ({
        productId: b.productId,
        sku: b.product.sku,
        name: b.product.name,
        uom: b.product.baseUom.code,
        warehouse: b.warehouse,
        qtyOnHand: b.qtyOnHand,
        minStock: b.product.minStock,
        shortBy: b.product.minStock.sub(b.qtyOnHand),
      }))
      .sort((a, b) => b.shortBy.comparedTo(a.shortBy));
  }

  /**
   * กำไรขั้นต้นรายบรรทัด: รายได้จากใบแจ้งหนี้ − ต้นทุนจริงที่ออกจากคลัง
   *
   * ต้นทุนไม่ได้เดาจากทุนเฉลี่ยปัจจุบัน แต่อ่านจาก movement ที่ผูกกับใบส่งของ
   * ใบนั้นจริง ๆ — สินค้า FIFO จึงได้ต้นทุนของล็อตที่ส่งออกไปจริง
   */
  async grossProfit(params: { from?: string; to?: string; partnerId?: string }) {
    const where: Prisma.InvoiceLineWhereInput = {
      invoice: {
        status: { not: InvoiceStatus.VOID },
        ...(params.partnerId ? { partnerId: params.partnerId } : {}),
        ...(params.from || params.to
          ? {
              docDate: {
                ...(params.from ? { gte: new Date(params.from) } : {}),
                ...(params.to ? { lte: new Date(params.to) } : {}),
              },
            }
          : {}),
      },
    };

    const lines = await this.prisma.invoiceLine.findMany({
      where,
      include: {
        product: { select: { sku: true, name: true } },
        invoice: { select: { docNo: true, docDate: true, partnerId: true } },
        sourceLine: { select: { movementId: true } },
      },
    });

    const movementIds = lines
      .map((l) => l.sourceLine?.movementId)
      .filter((id): id is string => Boolean(id));
    const movements = await this.prisma.stockMovement.findMany({
      where: { id: { in: movementIds } },
      select: { id: true, totalCost: true },
    });
    const costById = new Map(movements.map((m) => [m.id, m.totalCost.abs()]));

    let totalRevenue = new D(0);
    let totalCost = new D(0);
    const byProduct = new Map<
      string,
      { sku: string; name: string; revenue: Prisma.Decimal; cost: Prisma.Decimal; qty: Prisma.Decimal }
    >();

    const detail = lines.map((line) => {
      const revenue = line.lineTotal;
      const cost = line.sourceLine?.movementId
        ? (costById.get(line.sourceLine.movementId) ?? new D(0))
        : new D(0);
      const profit = revenue.sub(cost);

      totalRevenue = totalRevenue.add(revenue);
      totalCost = totalCost.add(cost);

      const acc = byProduct.get(line.productId) ?? {
        sku: line.product.sku,
        name: line.product.name,
        revenue: new D(0),
        cost: new D(0),
        qty: new D(0),
      };
      acc.revenue = acc.revenue.add(revenue);
      acc.cost = acc.cost.add(cost);
      acc.qty = acc.qty.add(line.baseQty);
      byProduct.set(line.productId, acc);

      return {
        invoiceNo: line.invoice.docNo,
        docDate: line.invoice.docDate,
        sku: line.product.sku,
        productName: line.product.name,
        qty: line.qty,
        baseQty: line.baseQty,
        revenue,
        cost,
        profit,
        marginPercent: revenue.isZero()
          ? new D(0)
          : profit.div(revenue).mul(100).toDecimalPlaces(2),
      };
    });

    const totalProfit = totalRevenue.sub(totalCost);
    return {
      summary: {
        revenue: totalRevenue,
        cost: totalCost,
        profit: totalProfit,
        marginPercent: totalRevenue.isZero()
          ? new D(0)
          : totalProfit.div(totalRevenue).mul(100).toDecimalPlaces(2),
        lineCount: detail.length,
      },
      byProduct: [...byProduct.entries()]
        .map(([productId, v]) => ({
          productId,
          ...v,
          profit: v.revenue.sub(v.cost),
        }))
        .sort((a, b) => b.profit.comparedTo(a.profit)),
      detail,
    };
  }
}
