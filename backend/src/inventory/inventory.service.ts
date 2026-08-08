import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MovementType, Prisma, SerialStatus } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CostingService } from './costing/costing.service';
import type { CostingContext, Tx } from './costing/costing.types';
import { applyMovingAverage } from './costing/costing.util';
import { TrackingService } from './tracking/tracking.service';
import {
  AdjustStockDto,
  ExpiringLotsDto,
  IssueStockDto,
  QueryLotsDto,
  QueryMovementsDto,
  QuerySerialsDto,
  ReceiveStockDto,
  StockCardQueryDto,
} from './inventory.dto';

const D = Prisma.Decimal;

interface LockedBalance {
  qtyOnHand: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

interface MovementInput {
  productId: string;
  warehouseId: string;
  /** signed + หน่วยฐาน: บวก = เข้า, ลบ = ออก */
  qty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  /** signed ตาม qty — ส่งมาตรง ๆ เพื่อไม่ให้เกิดเศษจากการหาร/คูณซ้ำ */
  totalCost: Prisma.Decimal;
  movementType: MovementType;
  refDocType: string;
  refDocId: string;
  note?: string;
  lotId?: string | null;
  reversalOfId?: string;
  createdBy: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
    private readonly tracking: TrackingService,
  ) {}

  /**
   * Lock แถว balance ของ (product, warehouse) ด้วย SELECT ... FOR UPDATE
   * — คนที่สองที่แตะสินค้าเดียวกันต้องรอจนคนแรก commit เสมอ
   * แถวยังไม่มี → INSERT ... ON CONFLICT DO NOTHING ก่อน (กัน race ตอนสร้างแถวแรก)
   *
   * lock นี้คุ้มครอง cost_layers ของสินค้านั้นด้วย เพราะทุกทางเข้าถึง layer
   * ต้องผ่าน lock นี้ก่อน → การกิน layer ของสินค้าเดียวกันถูก serialize
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

  private async assertProductActive(tx: Tx, productId: string) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) {
      throw new NotFoundException('ไม่พบสินค้า หรือสินค้าถูกปิดใช้งาน');
    }
    return product;
  }

  /** เขียน movement + อัปเดต balance cache ใน tx เดียวกัน */
  private async writeMovement(
    tx: Tx,
    input: MovementInput,
    balance: LockedBalance,
  ) {
    const { newQty, newAvg } = applyMovingAverage(
      balance.qtyOnHand,
      balance.avgCost,
      input.qty,
      input.totalCost,
    );
    const movement = await tx.stockMovement.create({ data: input });
    await tx.stockBalance.update({
      where: {
        productId_warehouseId: {
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
      },
      data: { qtyOnHand: newQty, avgCost: newAvg },
    });
    return movement;
  }

  // ---------- รับเข้า ----------
  /**
   * เอกสาร (ใบรับของ/ใบส่งของ) เรียก *InTx เพื่อให้การ post stock
   * อยู่ใน transaction เดียวกับการเปลี่ยนสถานะเอกสาร — พังข้อไหน rollback ทั้งหมด
   */
  async receive(dto: ReceiveStockDto, userId: string) {
    return this.prisma.$transaction((tx) => this.receiveInTx(tx, dto, userId));
  }

  async receiveInTx(tx: Tx, dto: ReceiveStockDto, userId: string) {
    return (async () => {
      const product = await this.assertProductActive(tx, dto.productId);
      const balance = await this.lockBalance(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const ctx: CostingContext = {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        avgCost: balance.avgCost,
      };
      const qty = new D(dto.qty);
      const unitCost = new D(dto.unitCost);

      const { lotId } = await this.tracking.prepareInflow(
        tx,
        product,
        dto.warehouseId,
        qty,
        dto,
      );
      ctx.lotId = lotId;

      const movement = await this.writeMovement(
        tx,
        {
          productId: ctx.productId,
          warehouseId: ctx.warehouseId,
          qty,
          unitCost,
          totalCost: qty.mul(unitCost).toDecimalPlaces(2),
          movementType: MovementType.RECEIVE,
          refDocType: dto.refDocType ?? 'MANUAL',
          refDocId: dto.refDocId,
          note: dto.note,
          lotId,
          createdBy: userId,
        },
        balance,
      );

      await this.costing
        .forMethod(product.costingMethod)
        .afterReceive(tx, ctx, movement.id, qty, unitCost, movement.createdAt);
      await this.tracking.afterInflow(
        tx,
        product,
        movement.id,
        dto.warehouseId,
        dto,
      );

      return movement;
    })();
  }

  // ---------- จ่ายออก (กันติดลบ) ----------
  async issue(dto: IssueStockDto, userId: string) {
    return this.prisma.$transaction((tx) => this.issueInTx(tx, dto, userId));
  }

  async issueInTx(tx: Tx, dto: IssueStockDto, userId: string) {
    return (async () => {
      const product = await this.assertProductActive(tx, dto.productId);
      const balance = await this.lockBalance(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const qty = new D(dto.qty);
      if (balance.qtyOnHand.lessThan(qty)) {
        throw new UnprocessableEntityException(
          `สต๊อกไม่พอ: คงเหลือ ${balance.qtyOnHand.toString()} ต้องการจ่าย ${qty.toString()}`,
        );
      }

      const ctx: CostingContext = {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        avgCost: balance.avgCost,
      };
      const { lotId } = await this.tracking.prepareOutflow(
        tx,
        product,
        dto.warehouseId,
        qty,
        dto,
      );
      ctx.lotId = lotId;

      const strategy = this.costing.forMethod(product.costingMethod);
      const quote = await strategy.quoteIssue(tx, ctx, qty);

      const movement = await this.writeMovement(
        tx,
        {
          productId: ctx.productId,
          warehouseId: ctx.warehouseId,
          qty: qty.neg(),
          unitCost: quote.unitCost,
          totalCost: quote.totalCost.neg(),
          movementType: MovementType.ISSUE,
          refDocType: dto.refDocType ?? 'MANUAL',
          refDocId: dto.refDocId,
          note: dto.note,
          lotId,
          createdBy: userId,
        },
        balance,
      );

      await strategy.afterIssue(tx, movement.id, quote);
      await this.tracking.afterOutflow(
        tx,
        product,
        movement.id,
        dto,
        movement.createdAt,
      );
      return movement;
    })();
  }

  // ---------- ปรับยอดจากการนับจริง ----------
  async adjust(dto: AdjustStockDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.assertProductActive(tx, dto.productId);
      const balance = await this.lockBalance(
        tx,
        dto.productId,
        dto.warehouseId,
      );
      const diff = new D(dto.actualQty).sub(balance.qtyOnHand);
      if (diff.isZero()) {
        throw new BadRequestException(
          'ยอดนับจริงเท่ากับยอดในระบบ ไม่มีอะไรต้องปรับ',
        );
      }

      const ctx: CostingContext = {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        avgCost: balance.avgCost,
      };
      const strategy = this.costing.forMethod(product.costingMethod);
      const isIncrease = diff.greaterThan(0);

      const { lotId } = isIncrease
        ? await this.tracking.prepareInflow(
            tx,
            product,
            dto.warehouseId,
            diff,
            dto,
          )
        : await this.tracking.prepareOutflow(
            tx,
            product,
            dto.warehouseId,
            diff.neg(),
            dto,
          );
      ctx.lotId = lotId;

      // ปรับเพิ่ม = เหมือนรับเข้า (สร้าง layer) / ปรับลด = เหมือนจ่ายออก (กิน layer)
      const quote = isIncrease
        ? null
        : await strategy.quoteIssue(tx, ctx, diff.neg());
      const unitCost = isIncrease
        ? dto.unitCost !== undefined
          ? new D(dto.unitCost)
          : balance.avgCost
        : quote!.unitCost;
      const totalCost = isIncrease
        ? diff.mul(unitCost).toDecimalPlaces(2)
        : quote!.totalCost.neg();

      const movement = await this.writeMovement(
        tx,
        {
          productId: ctx.productId,
          warehouseId: ctx.warehouseId,
          qty: diff,
          unitCost,
          totalCost,
          movementType: isIncrease
            ? MovementType.ADJUST_IN
            : MovementType.ADJUST_OUT,
          refDocType: 'ADJUSTMENT',
          refDocId: dto.reason,
          note: dto.note,
          lotId,
          createdBy: userId,
        },
        balance,
      );

      if (isIncrease) {
        await strategy.afterReceive(
          tx,
          ctx,
          movement.id,
          diff,
          unitCost,
          movement.createdAt,
        );
        await this.tracking.afterInflow(
          tx,
          product,
          movement.id,
          dto.warehouseId,
          dto,
        );
      } else {
        await strategy.afterIssue(tx, movement.id, quote!);
        await this.tracking.afterOutflow(
          tx,
          product,
          movement.id,
          dto,
          movement.createdAt,
        );
      }
      return movement;
    });
  }

  // ---------- กลับรายการ (ไม่ลบของเดิม) ----------
  async reverse(movementId: string, userId: string) {
    return this.prisma.$transaction((tx) => this.reverseInTx(tx, movementId, userId));
  }

  async reverseInTx(tx: Tx, movementId: string, userId: string) {
    return (async () => {
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

      const product = await this.assertProductActive(tx, original.productId);
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

      const movement = await this.writeMovement(
        tx,
        {
          productId: original.productId,
          warehouseId: original.warehouseId,
          qty: revQty,
          unitCost: original.unitCost,
          totalCost: original.totalCost.neg(),
          movementType: MovementType.REVERSAL,
          refDocType: original.refDocType,
          refDocId: original.refDocId,
          note: `กลับรายการของ ${original.id}`,
          lotId: original.lotId,
          reversalOfId: original.id,
          createdBy: userId,
        },
        balance,
      );

      const strategy = this.costing.forMethod(product.costingMethod);
      const wasInflow = original.qty.greaterThan(0);
      if (wasInflow) {
        await strategy.reverseReceive(tx, original.id, movement.id);
        await this.tracking.reverseInflow(tx, product, original.id);
      } else {
        await strategy.reverseIssue(tx, original.id, movement.id);
        await this.tracking.reverseOutflow(
          tx,
          product,
          original.id,
          original.warehouseId,
        );
      }
      return movement;
    })();
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
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
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

  /**
   * สร้าง layer "ยอดยกมา" ให้สินค้า FIFO ที่มีสต๊อกอยู่แล้วแต่ layer ไม่ครบ
   *
   * เกิดได้ 2 กรณีจริงในธุรกิจ:
   *  1. สลับ costing_method จาก AVG → FIFO ตอนที่ของในคลังยังมีอยู่
   *  2. backfill ข้อมูลที่มีมาก่อนระบบ FIFO
   * ถ้าไม่ทำ ยอดคงเหลือจะมีของแต่ layer ว่าง → จ่ายออกไม่ได้เลย
   *
   * ทุนของยอดยกมาใช้ทุนเฉลี่ยขณะนั้น และตั้ง received_at ให้เก่าที่สุด
   * เพื่อให้ของยกมาถูกจ่ายออกก่อนล็อตใหม่ตามหลัก FIFO
   */
  async ensureFifoOpeningLayers(productId: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: { productId, qtyOnHand: { gt: 0 } },
    });

    const created: { warehouseId: string; qty: string; unitCost: string }[] = [];
    for (const balance of balances) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockBalance(tx, productId, balance.warehouseId);
        const agg = await tx.costLayer.aggregate({
          where: { productId, warehouseId: balance.warehouseId },
          _sum: { remainingQty: true },
        });
        const gap = locked.qtyOnHand.sub(agg._sum.remainingQty ?? new D(0));
        if (gap.lessThanOrEqualTo(0)) return;

        const firstMovement = await tx.stockMovement.findFirst({
          where: { productId, warehouseId: balance.warehouseId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });

        await tx.costLayer.create({
          data: {
            productId,
            warehouseId: balance.warehouseId,
            originalQty: gap,
            remainingQty: gap,
            unitCost: locked.avgCost,
            receivedAt: firstMovement?.createdAt ?? new Date(),
            isOpening: true,
            note: 'ยอดยกมาตอนเริ่มใช้ FIFO (ทุน = ทุนเฉลี่ยขณะนั้น)',
          },
        });
        created.push({
          warehouseId: balance.warehouseId,
          qty: gap.toString(),
          unitCost: locked.avgCost.toString(),
        });
      });
    }
    return created;
  }

  /** backfill ยอดยกมาให้สินค้า FIFO ทุกตัวที่ layer ยังไม่ครบ (เครื่องมือ migration) */
  async backfillFifoOpeningLayers() {
    const products = await this.prisma.product.findMany({
      where: { costingMethod: 'FIFO' },
      select: { id: true, sku: true },
    });
    const result: { sku: string; layers: unknown[] }[] = [];
    for (const product of products) {
      const layers = await this.ensureFifoOpeningLayers(product.id);
      if (layers.length) result.push({ sku: product.sku, layers });
    }
    return { productsFixed: result.length, detail: result };
  }

  // ---------- FIFO layers (ตรวจสอบต้นทุนย้อนหลัง) ----------
  async costLayers(productId: string, warehouseId?: string) {
    return this.prisma.costLayer.findMany({
      where: {
        productId,
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        consumptions: {
          include: {
            issueMovement: {
              select: { id: true, refDocType: true, refDocId: true, createdAt: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ receivedAt: 'asc' }],
    });
  }

  // ---------- Serial: หน้าเคลม/ประกัน ----------

  /**
   * ยิง serial บนตัวเครื่อง → รู้ทันทีว่าซื้อเมื่อไหร่ ใครซื้อ ประกันเหลือกี่วัน
   * นี่คือ endpoint ที่หน้าร้านใช้บ่อยที่สุดตอนลูกค้าถือของมาเคลม
   */
  async findSerial(serial: string) {
    const record = await this.prisma.serialNumber.findUnique({
      where: { serial: serial.trim() },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            brand: true,
            model: true,
            warrantyMonths: true,
          },
        },
        warehouse: { select: { code: true, name: true } },
        soldToPartner: { select: { code: true, name: true, phone: true } },
        receiveMovement: {
          select: { refDocType: true, refDocId: true, createdAt: true },
        },
        issueMovement: {
          select: { refDocType: true, refDocId: true, createdAt: true },
        },
      },
    });
    if (!record) throw new NotFoundException('ไม่พบ serial นี้ในระบบ');

    const now = new Date();
    const warrantyDaysLeft = record.warrantyEnd
      ? Math.ceil(
          (record.warrantyEnd.getTime() - now.getTime()) / 86_400_000,
        )
      : null;

    return {
      ...record,
      warranty: {
        months: record.product.warrantyMonths,
        endAt: record.warrantyEnd,
        daysLeft: warrantyDaysLeft,
        // ยังไม่ขาย = ยังไม่เริ่มนับประกัน
        inWarranty:
          record.warrantyEnd !== null && warrantyDaysLeft !== null
            ? warrantyDaysLeft > 0
            : false,
      },
    };
  }

  async serials(query: QuerySerialsDto) {
    const where: Prisma.SerialNumberWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status as SerialStatus } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.serialNumber.findMany({
        where,
        include: {
          product: { select: { sku: true, name: true } },
          soldToPartner: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.serialNumber.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  // ---------- Lot: ยอดคงเหลือราย lot + FEFO ----------

  /**
   * ล็อตของสินค้าพร้อมยอดคงเหลือ เรียงแบบ FEFO (First-Expired-First-Out)
   * ของใกล้หมดอายุต้องออกก่อนเสมอ — ล็อตที่ไม่มีวันหมดอายุไว้ท้ายสุด
   */
  async lots(query: QueryLotsDto) {
    const lots = await this.prisma.lot.findMany({
      where: { productId: query.productId },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
    });
    if (!lots.length) return [];

    const sums = await this.prisma.stockMovement.groupBy({
      by: ['lotId', 'warehouseId'],
      where: {
        lotId: { in: lots.map((l) => l.id) },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      },
      _sum: { qty: true },
    });

    const remainingByLot = new Map<string, Prisma.Decimal>();
    for (const s of sums) {
      if (!s.lotId) continue;
      const current = remainingByLot.get(s.lotId) ?? new D(0);
      remainingByLot.set(s.lotId, current.add(s._sum.qty ?? new D(0)));
    }

    const now = Date.now();
    const result = lots.map((lot) => {
      const remaining = remainingByLot.get(lot.id) ?? new D(0);
      const daysToExpiry = lot.expiryDate
        ? Math.ceil((lot.expiryDate.getTime() - now) / 86_400_000)
        : null;
      return {
        id: lot.id,
        lotNo: lot.lotNo,
        expiryDate: lot.expiryDate,
        receivedAt: lot.receivedAt,
        remainingQty: remaining,
        daysToExpiry,
        isExpired: daysToExpiry !== null && daysToExpiry <= 0,
      };
    });

    return query.availableOnly === false
      ? result
      : result.filter((l) => l.remainingQty.greaterThan(0));
  }

  /** ล็อตที่จะหมดอายุเร็ว ๆ นี้ — ใช้แจ้งเตือน (cron เฟส 6) และหน้าจัดโปรระบายของ */
  async expiringLots(query: ExpiringLotsDto) {
    const days = query.days ?? 30;
    const deadline = new Date(Date.now() + days * 86_400_000);

    const lots = await this.prisma.lot.findMany({
      where: { expiryDate: { not: null, lte: deadline } },
      include: { product: { select: { sku: true, name: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    if (!lots.length) return { days, lots: [] };

    const sums = await this.prisma.stockMovement.groupBy({
      by: ['lotId'],
      where: { lotId: { in: lots.map((l) => l.id) } },
      _sum: { qty: true },
    });
    const remaining = new Map(
      sums.map((s) => [s.lotId!, s._sum.qty ?? new D(0)]),
    );

    const now = Date.now();
    return {
      days,
      lots: lots
        .map((lot) => ({
          lotId: lot.id,
          lotNo: lot.lotNo,
          sku: lot.product.sku,
          productName: lot.product.name,
          expiryDate: lot.expiryDate,
          remainingQty: remaining.get(lot.id) ?? new D(0),
          daysToExpiry: Math.ceil(
            (lot.expiryDate!.getTime() - now) / 86_400_000,
          ),
        }))
        .filter((l) => l.remainingQty.greaterThan(0)),
    };
  }

  // ---------- Reconcile: cache + layer ต้องตรงกับ ledger เสมอ ----------
  async reconcile() {
    const sums = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'warehouseId'],
      _sum: { qty: true },
    });
    const balances = await this.prisma.stockBalance.findMany({
      include: {
        product: { select: { sku: true, costingMethod: true } },
      },
    });

    const ledger = new Map(
      sums.map((s) => [
        `${s.productId}:${s.warehouseId}`,
        s._sum.qty ?? new D(0),
      ]),
    );
    const mismatches: {
      kind: 'BALANCE' | 'COST_LAYER';
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
          kind: 'BALANCE',
          productId: b.productId,
          sku: b.product.sku,
          warehouseId: b.warehouseId,
          ledgerQty: ledgerQty.toString(),
          cacheQty: b.qtyOnHand.toString(),
        });
      }

      // สินค้า FIFO: ผลรวม remaining ของทุก layer ต้องเท่ากับยอดคงเหลือ
      if (b.product.costingMethod === 'FIFO') {
        const layerAgg = await this.prisma.costLayer.aggregate({
          where: { productId: b.productId, warehouseId: b.warehouseId },
          _sum: { remainingQty: true },
        });
        const layerQty = layerAgg._sum.remainingQty ?? new D(0);
        if (!layerQty.equals(b.qtyOnHand)) {
          mismatches.push({
            kind: 'COST_LAYER',
            productId: b.productId,
            sku: b.product.sku,
            warehouseId: b.warehouseId,
            ledgerQty: b.qtyOnHand.toString(),
            cacheQty: layerQty.toString(),
          });
        }
      }
    }
    // movement มีแต่แถว balance หาย = ผิดปกติเช่นกัน
    for (const [key, qty] of ledger) {
      const [productId, warehouseId] = key.split(':');
      mismatches.push({
        kind: 'BALANCE',
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
        product: {
          select: {
            sku: true,
            name: true,
            minStock: true,
            costingMethod: true,
          },
        },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ productId: 'asc' }],
    });
  }
}
