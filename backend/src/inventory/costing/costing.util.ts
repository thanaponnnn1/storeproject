import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export interface FifoLayerInput {
  id: string;
  remainingQty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

export interface AllocationLine {
  layerId: string;
  qty: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

export interface FifoAllocation {
  lines: AllocationLine[];
  /** ทุนรวมของจำนวนที่จ่ายออก (ค่าบวก) */
  totalCost: Prisma.Decimal;
  /** ทุนเฉลี่ยถ่วงน้ำหนักของจำนวนที่จ่าย — ใช้บันทึกลง movement */
  unitCost: Prisma.Decimal;
  /** จำนวนที่ layer ไม่พอจ่าย (ปกติต้องเป็น 0) */
  shortage: Prisma.Decimal;
}

/**
 * ตัดจำนวนออกจาก layer เก่าสุดก่อน (First-In First-Out)
 * layers ต้องเรียง received_at จากเก่า → ใหม่ มาแล้ว
 *
 * เป็นฟังก์ชัน pure ไม่แตะ DB — จุดที่ต้นทุนผิดพลาดง่ายที่สุดในระบบ
 * จึงแยกออกมาเพื่อทดสอบให้ครบทุก edge case
 */
export function allocateFifo(
  layers: FifoLayerInput[],
  qty: Prisma.Decimal,
): FifoAllocation {
  let remaining = qty;
  let totalCost = new D(0);
  const lines: AllocationLine[] = [];

  for (const layer of layers) {
    if (remaining.lessThanOrEqualTo(0)) break;
    if (layer.remainingQty.lessThanOrEqualTo(0)) continue;

    const take = layer.remainingQty.lessThan(remaining)
      ? layer.remainingQty
      : remaining;

    lines.push({ layerId: layer.id, qty: take, unitCost: layer.unitCost });
    totalCost = totalCost.add(take.mul(layer.unitCost));
    remaining = remaining.sub(take);
  }

  const allocated = qty.sub(remaining);
  return {
    lines,
    totalCost: totalCost.toDecimalPlaces(2),
    unitCost: allocated.isZero()
      ? new D(0)
      : totalCost.div(allocated).toDecimalPlaces(4),
    shortage: remaining,
  };
}

/**
 * Moving average คิดจากมูลค่า (ใช้กับสินค้า AVG และใช้ maintain avg_cost
 * ของสินค้า FIFO ไว้ทำรายงานมูลค่าสต๊อกด้วย)
 *
 * qtyDelta / totalCostDelta เป็น signed: บวก = เข้า, ลบ = ออก
 */
export function applyMovingAverage(
  qtyOnHand: Prisma.Decimal,
  avgCost: Prisma.Decimal,
  qtyDelta: Prisma.Decimal,
  totalCostDelta: Prisma.Decimal,
): { newQty: Prisma.Decimal; newAvg: Prisma.Decimal } {
  const newQty = qtyOnHand.add(qtyDelta);
  const newValue = qtyOnHand.mul(avgCost).add(totalCostDelta);
  // ของหมดคลัง → รีเซ็ตทุนเป็น 0 กันเศษทศนิยมค้างไปรบกวนการรับล็อตหน้า
  const newAvg = newQty.isZero()
    ? new D(0)
    : newValue.div(newQty).toDecimalPlaces(4);
  return { newQty, newAvg };
}
