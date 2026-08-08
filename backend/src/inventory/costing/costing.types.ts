import { CostingMethod, Prisma } from '@prisma/client';
import type { AllocationLine } from './costing.util';

export type Tx = Prisma.TransactionClient;

export interface CostingContext {
  productId: string;
  warehouseId: string;
  /** ทุนเฉลี่ยจากแถว balance ที่ lock ไว้แล้ว */
  avgCost: Prisma.Decimal;
  /**
   * สินค้า LOT: ต้นทุนต้องมาจากล็อตที่จ่ายจริง ไม่ใช่ล็อตที่รับเข้าก่อน
   * เพราะ FEFO เลือกล็อตตามวันหมดอายุ ซึ่งอาจสวนทางกับลำดับการรับเข้า
   */
  lotId?: string | null;
}

export interface IssueQuote {
  /** ทุนต่อหน่วยที่จะบันทึกลง movement */
  unitCost: Prisma.Decimal;
  /** ทุนรวมของการจ่ายครั้งนี้ (ค่าบวก) */
  totalCost: Prisma.Decimal;
  /** layer ที่ถูกกิน (AVG = ว่าง) */
  lines: AllocationLine[];
}

/**
 * วิธีคิดต้นทุน — สลับได้รายสินค้าผ่าน product.costingMethod
 * ทุก method ถูกเรียกภายใน transaction ที่ lock แถว balance ไว้แล้ว
 * จึงไม่ต้อง lock layer เพิ่ม (การเข้าถึง layer ของสินค้าเดียวกันถูก serialize แล้ว)
 */
export interface CostingStrategy {
  readonly method: CostingMethod;

  /** คิดทุนก่อนจ่ายออก (FIFO = เลือก layer, AVG = ใช้ทุนเฉลี่ย) */
  quoteIssue(
    tx: Tx,
    ctx: CostingContext,
    qty: Prisma.Decimal,
  ): Promise<IssueQuote>;

  /** หลังสร้าง movement รับเข้า — FIFO สร้าง layer ใหม่ */
  afterReceive(
    tx: Tx,
    ctx: CostingContext,
    movementId: string,
    qty: Prisma.Decimal,
    unitCost: Prisma.Decimal,
    receivedAt: Date,
  ): Promise<void>;

  /** หลังสร้าง movement จ่ายออก — FIFO ตัด layer + บันทึก consumption */
  afterIssue(tx: Tx, movementId: string, quote: IssueQuote): Promise<void>;

  /** กลับรายการ "รับเข้า" — FIFO คืน layer ทั้งก้อน (ต้องยังไม่ถูกจ่ายออก) */
  reverseReceive(
    tx: Tx,
    originalMovementId: string,
    reversalMovementId: string,
  ): Promise<void>;

  /** กลับรายการ "จ่ายออก" — FIFO คืน qty กลับ layer เดิมตาม consumption */
  reverseIssue(
    tx: Tx,
    originalMovementId: string,
    reversalMovementId: string,
  ): Promise<void>;
}
