import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CostingMethod, Prisma } from '@prisma/client';
import type {
  CostingContext,
  CostingStrategy,
  IssueQuote,
  Tx,
} from './costing.types';
import { allocateFifo } from './costing.util';

@Injectable()
export class FifoStrategy implements CostingStrategy {
  readonly method = CostingMethod.FIFO;

  /** เลือก layer เก่าสุดก่อน — อาจคร่อมหลาย layer */
  async quoteIssue(
    tx: Tx,
    ctx: CostingContext,
    qty: Prisma.Decimal,
  ): Promise<IssueQuote> {
    const layers = await tx.costLayer.findMany({
      where: {
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        remainingQty: { gt: 0 },
        // สินค้า LOT: กินเฉพาะทุนของล็อตที่จ่ายจริง
        ...(ctx.lotId ? { lotId: ctx.lotId } : {}),
      },
      // id เป็น tie-breaker ให้ผลลัพธ์เหมือนกันทุกครั้งเมื่อ received_at ชนกัน
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });

    const allocation = allocateFifo(layers, qty);
    if (allocation.shortage.greaterThan(0)) {
      // ยอด balance บอกว่าพอ แต่ layer ไม่พอ = ข้อมูลต้นทุนเพี้ยน ห้ามปล่อยผ่าน
      throw new UnprocessableEntityException(
        `cost layer ไม่พอจ่าย ${allocation.shortage.toString()} หน่วย — ข้อมูลต้นทุนไม่ตรงกับยอดคงเหลือ ให้ตรวจ /inventory/reconcile`,
      );
    }
    return allocation;
  }

  async afterReceive(
    tx: Tx,
    ctx: CostingContext,
    movementId: string,
    qty: Prisma.Decimal,
    unitCost: Prisma.Decimal,
    receivedAt: Date,
  ): Promise<void> {
    await tx.costLayer.create({
      data: {
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        sourceMovementId: movementId,
        originalQty: qty,
        remainingQty: qty,
        unitCost,
        receivedAt,
        lotId: ctx.lotId ?? null,
      },
    });
  }

  async afterIssue(
    tx: Tx,
    movementId: string,
    quote: IssueQuote,
  ): Promise<void> {
    for (const line of quote.lines) {
      await tx.costLayer.update({
        where: { id: line.layerId },
        data: { remainingQty: { decrement: line.qty } },
      });
      await tx.costLayerConsumption.create({
        data: {
          layerId: line.layerId,
          issueMovementId: movementId,
          qty: line.qty,
          unitCost: line.unitCost,
        },
      });
    }
  }

  /**
   * กลับรายการรับเข้า = ยกเลิก layer ทั้งก้อน
   * ถ้าของในก้อนถูกจ่ายออกไปแล้วบางส่วน ต้องกลับรายการการจ่ายก่อน
   * ไม่งั้นประวัติต้นทุนของบิลที่ขายไปแล้วจะเสียหาย
   */
  async reverseReceive(
    tx: Tx,
    originalMovementId: string,
    reversalMovementId: string,
  ): Promise<void> {
    const layer = await tx.costLayer.findUnique({
      where: { sourceMovementId: originalMovementId },
    });
    if (!layer) return;

    if (!layer.remainingQty.equals(layer.originalQty)) {
      throw new UnprocessableEntityException(
        'ของจากล็อตนี้ถูกจ่ายออกไปบางส่วนแล้ว — ต้องกลับรายการการจ่ายออกก่อนจึงจะยกเลิกการรับเข้าได้',
      );
    }

    // ปิดก้อนด้วย consumption เต็มจำนวน เพื่อรักษา invariant
    // original_qty - SUM(consumptions) = remaining_qty
    await tx.costLayer.update({
      where: { id: layer.id },
      data: { remainingQty: 0 },
    });
    await tx.costLayerConsumption.create({
      data: {
        layerId: layer.id,
        issueMovementId: reversalMovementId,
        qty: layer.originalQty,
        unitCost: layer.unitCost,
      },
    });
  }

  /** กลับรายการจ่ายออก = คืน qty กลับ layer เดิมทุกก้อนตามที่เคยกินไป */
  async reverseIssue(
    tx: Tx,
    originalMovementId: string,
    reversalMovementId: string,
  ): Promise<void> {
    const consumptions = await tx.costLayerConsumption.findMany({
      where: { issueMovementId: originalMovementId },
    });

    for (const c of consumptions) {
      await tx.costLayer.update({
        where: { id: c.layerId },
        data: { remainingQty: { increment: c.qty } },
      });
      await tx.costLayerConsumption.create({
        data: {
          layerId: c.layerId,
          issueMovementId: reversalMovementId,
          qty: c.qty.neg(),
          unitCost: c.unitCost,
        },
      });
    }
  }
}
