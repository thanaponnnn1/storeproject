import { Injectable } from '@nestjs/common';
import { CostingMethod, Prisma } from '@prisma/client';
import type {
  CostingContext,
  CostingStrategy,
  IssueQuote,
  Tx,
} from './costing.types';

/**
 * ทุนเฉลี่ยเคลื่อนที่ — จ่ายออกที่ทุนเฉลี่ยปัจจุบัน ไม่มี layer ให้ดูแล
 * ทุกอย่างอยู่ในแถว stock_balances ที่ถูก lock แล้ว
 */
@Injectable()
export class AverageStrategy implements CostingStrategy {
  readonly method = CostingMethod.AVG;

  quoteIssue(
    _tx: Tx,
    ctx: CostingContext,
    qty: Prisma.Decimal,
  ): Promise<IssueQuote> {
    return Promise.resolve({
      unitCost: ctx.avgCost,
      totalCost: qty.mul(ctx.avgCost).toDecimalPlaces(2),
      lines: [],
    });
  }

  afterReceive(): Promise<void> {
    return Promise.resolve();
  }

  afterIssue(): Promise<void> {
    return Promise.resolve();
  }

  reverseReceive(): Promise<void> {
    return Promise.resolve();
  }

  reverseIssue(): Promise<void> {
    return Promise.resolve();
  }
}
