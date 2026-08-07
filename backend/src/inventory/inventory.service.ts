import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustStockDto,
  IssueStockDto,
  QueryMovementsDto,
  ReceiveStockDto,
  StockCardQueryDto,
} from './inventory.dto';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

interface LockedBalance {
  qtyOnHand: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lock แถว balance ของ (product, warehouse) ด้วย SELECT ... FOR UPDATE
   * — คนที่สองที่แตะสินค้าเดียวกันต้องรอจนคนแรก commit เสมอ
   * แถวยังไม่มี → INSERT ... ON CONFLICT DO NOTHING ก่อน (กัน race ตอนสร้างแถวแรก)
   */
  private async lockBalance(
    tx: Tx,
    productId: string,
    warehouseId: string,
  ): Promise<LockedBalance> {
    await tx.$executeRaw`
      INSERT INTO stock_balances (product_id, warehouse_id, qty_on_hand, avg_cost, updated_at)
      VALUES (${productId}, ${warehouseId}, 0, 0, now())
      ON CONFLICT (product_id, warehouse_id) DO NOTHING`;
    const rows = await tx.$queryRaw<
      { qty_on_hand: Prisma.Decimal; avg_cost: Prisma.Decimal }[]
    >`
      SELECT qty_on_hand, avg_cost FROM stock_balances
      WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}
      FOR UPDATE`;
    const row = rows[0]!;
    return { qtyOnHand: row.qty_on_hand, avgCost: row.avg_cost };
  }

  /**
   * สูตรเดียวใช้ทุกกรณี (moving average แบบคิดจากมูลค่า):
   * newQty = qty เดิม + qty ที่ขยับ (signed), newValue = มูลค่าเดิม + qty×ทุน
   * - RECEIVE: avg ขยับเข้าหาทุนใหม่
   * - ISSUE ที่ทุน avg: avg คงเดิม
   * - REVERSAL: ถอยมูลค่ากลับตามทุนของ movement เดิม
   */
  private applyToBalance(
    balance: LockedBalance,
    qty: Prisma.Decimal,
    unitCost: Prisma.Decimal,
  ): { newQty: Prisma.Decimal; newAvg: Prisma.Decimal } {
    const newQty = balance.qtyOnHand.add(qty);
    const newValue = balance.qtyOnHand
      .mul(balance.avgCost)
      .add(qty.mul(unitCost));
    const newAvg = newQty.isZero()
      ? new D(0)
      : newValue.div(newQty).toDecimalPlaces(4);
    return { newQty, newAvg };
  }

  private async assertProductActive(tx: Tx, productId: string) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) {
      throw new NotFoundException('ไม่พบสินค้า หรือสินค้าถูกปิดใช้งาน');
    }
    return product;
  }

  private async writeMovement(
    tx: Tx,
    data: {
      productId: string;
      warehouseId: string;
      qty: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      movementType: MovementType;
      refDocType: string;
      refDocId: string;
      note?: string;
      reversalOfId?: string;
      createdBy: string;
    },
    balance: LockedBalance,
  ) {
    const { newQty, newAvg } = this.applyToBalance(
      balance,
      data.qty,
      data.unitCost,
    );
    const movement = await tx.stockMovement.create({
      data: {
        ...data,
        totalCost: data.qty.mul(data.unitCost).toDecimalPlaces(2),
      },
    });
    await tx.stockBalance.update({
      where: {
        productId_warehouseId: {
          productId: data.productId,
          warehouseId: data.warehouseId,
        },
      },
      data: { qtyOnHand: newQty, avgCost: newAvg },
    });
    return movement;
  }

  // ---------- รับเข้า ----------
  async receive(dto: ReceiveStockDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertProductActive(tx, dto.productId);
      const balance = await this.lockBalance(tx, dto.productId, dto.warehouseId);
      return this.writeMovement(
        tx,
        {
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          qty: new D(dto.qty),
          unitCost: new D(dto.unitCost),
          movementType: MovementType.RECEIVE,
          refDocType: dto.refDocType ?? 'MANUAL',
          refDocId: dto.refDocId,
          note: dto.note,
          createdBy: userId,
        },
        balance,
      );
    });
  }

  // ---------- จ่ายออก (กันติดลบ) ----------
  async issue(dto: IssueStockDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertProductActive(tx, dto.productId);
      const balance = await this.lockBalance(tx, dto.productId, dto.warehouseId);
      const qty = new D(dto.qty);
      if (balance.qtyOnHand.lessThan(qty)) {
        throw new UnprocessableEntityException(
          `สต๊อกไม่พอ: คงเหลือ ${balance.qtyOnHand.toString()} ต้องการจ่าย ${qty.toString()}`,
        );
      }
      return this.writeMovement(
        tx,
        {
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          qty: qty.neg(),
          unitCost: balance.avgCost, // เฟส 2: ตัดที่ทุนเฉลี่ย (FIFO มาเฟส 3)
          movementType: MovementType.ISSUE,
          refDocType: dto.refDocType ?? 'MANUAL',
          refDocId: dto.refDocId,
          note: dto.note,
          createdBy: userId,
        },
        balance,
      );
    });
  }

  // ---------- ปรับยอดจากการนับจริง ----------
  async adjust(dto: AdjustStockDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertProductActive(tx, dto.productId);
      const balance = await this.lockBalance(tx, dto.productId, dto.warehouseId);
      const actual = new D(dto.actualQty);
      const diff = actual.sub(balance.qtyOnHand);
      if (diff.isZero()) {
        throw new BadRequestException(
          'ยอดนับจริงเท่ากับยอดในระบบ ไม่มีอะไรต้องปรับ',
        );
      }
      const isIncrease = diff.greaterThan(0);
      const unitCost =
        isIncrease && dto.unitCost !== undefined
          ? new D(dto.unitCost)
          : balance.avgCost;
      return this.writeMovement(
        tx,
        {
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          qty: diff,
          unitCost,
          movementType: isIncrease
            ? MovementType.ADJUST_IN
            : MovementType.ADJUST_OUT,
          refDocType: 'ADJUSTMENT',
          refDocId: dto.reason,
          note: dto.note,
          createdBy: userId,
        },
        balance,
      );
    });
  }

  // ---------- กลับรายการ (ไม่ลบของเดิม) ----------
  async reverse(movementId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.stockMovement.findUnique({
        where: { id: movementId },
        include: { reversedBy: true },
      });
      if (!original) throw new NotFoundException('ไม่พบ movement');
      if (original.movementType === MovementType.REVERSAL) {
        throw new UnprocessableEntityException(
          'กลับรายการของ REVERSAL ไม่ได้ — ให้ทำรายการใหม่ที่ถูกต้องแทน',
        );
      }
      if (original.reversedBy) {
        throw new ConflictException('movement นี้ถูกกลับรายการไปแล้ว');
      }

      const balance = await this.lockBalance(
        tx,
        original.productId,
        original.warehouseId,
      );
      const revQty = original.qty.neg();
      if (balance.qtyOnHand.add(revQty).lessThan(0)) {
        throw new UnprocessableEntityException(
          'กลับรายการแล้วสต๊อกจะติดลบ (ของถูกจ่ายออกไปแล้ว) — ตรวจสอบก่อน',
        );
      }
      return this.writeMovement(
        tx,
        {
          productId: original.productId,
          warehouseId: original.warehouseId,
          qty: revQty,
          unitCost: original.unitCost,
          movementType: MovementType.REVERSAL,
          refDocType: original.refDocType,
          refDocId: original.refDocId,
          note: `กลับรายการของ ${original.id}`,
          reversalOfId: original.id,
          createdBy: userId,
        },
        balance,
      );
    });
  }

  // ---------- Stock card ----------
  async stockCard(query: StockCardQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const openingAgg = from
      ? await this.prisma.stockMovement.aggregate({
          where: {
            productId: query.productId,
            warehouseId: query.warehouseId,
            createdAt: { lt: from },
          },
          _sum: { qty: true },
        })
      : null;
    const openingQty = openingAgg?._sum.qty ?? new D(0);
    let runningQty = openingQty;

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        productId: query.productId,
        warehouseId: query.warehouseId,
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const entries = movements.map((m) => {
      runningQty = runningQty.add(m.qty);
      return {
        id: m.id,
        createdAt: m.createdAt,
        movementType: m.movementType,
        refDocType: m.refDocType,
        refDocId: m.refDocId,
        qty: m.qty,
        unitCost: m.unitCost,
        totalCost: m.totalCost,
        balance: runningQty,
        note: m.note,
      };
    });

    return {
      productId: query.productId,
      warehouseId: query.warehouseId,
      openingQty,
      entries,
      closingQty: runningQty,
    };
  }

  // ---------- รายการ movement ----------
  async movements(query: QueryMovementsDto) {
    const where: Prisma.StockMovementWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.refDocType ? { refDocType: query.refDocType } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { sku: true, name: true } },
          warehouse: { select: { code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  // ---------- Reconcile: cache ต้องตรงกับ ledger เสมอ ----------
  async reconcile() {
    const sums = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'warehouseId'],
      _sum: { qty: true },
    });
    const balances = await this.prisma.stockBalance.findMany({
      include: { product: { select: { sku: true, name: true } } },
    });

    const ledger = new Map(
      sums.map((s) => [
        `${s.productId}:${s.warehouseId}`,
        s._sum.qty ?? new D(0),
      ]),
    );
    const mismatches: {
      productId: string;
      sku: string;
      warehouseId: string;
      ledgerQty: string;
      cacheQty: string;
    }[] = [];

    for (const b of balances) {
      const key = `${b.productId}:${b.warehouseId}`;
      const ledgerQty = ledger.get(key) ?? new D(0);
      ledger.delete(key);
      if (!ledgerQty.equals(b.qtyOnHand)) {
        mismatches.push({
          productId: b.productId,
          sku: b.product.sku,
          warehouseId: b.warehouseId,
          ledgerQty: ledgerQty.toString(),
          cacheQty: b.qtyOnHand.toString(),
        });
      }
    }
    // movement มีแต่แถว balance หาย = ผิดปกติเช่นกัน
    for (const [key, qty] of ledger) {
      const [productId, warehouseId] = key.split(':');
      mismatches.push({
        productId: productId!,
        sku: '(ไม่มีแถว balance)',
        warehouseId: warehouseId!,
        ledgerQty: qty.toString(),
        cacheQty: '(missing)',
      });
    }

    return {
      checkedAt: new Date(),
      balancesChecked: balances.length,
      clean: mismatches.length === 0,
      mismatches,
    };
  }

  // ---------- ยอดคงเหลือ ----------
  async balances(productId?: string, warehouseId?: string) {
    return this.prisma.stockBalance.findMany({
      where: {
        ...(productId ? { productId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        product: { select: { sku: true, name: true, minStock: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ productId: 'asc' }],
    });
  }
}
