import { Injectable } from '@nestjs/common';
import { CostingMethod } from '@prisma/client';
import { AverageStrategy } from './average.strategy';
import type { CostingStrategy } from './costing.types';
import { FifoStrategy } from './fifo.strategy';

@Injectable()
export class CostingService {
  constructor(
    private readonly average: AverageStrategy,
    private readonly fifo: FifoStrategy,
  ) {}

  /** เลือกวิธีคิดต้นทุนตามที่ตั้งไว้ในตัวสินค้า */
  forMethod(method: CostingMethod): CostingStrategy {
    return method === CostingMethod.FIFO ? this.fifo : this.average;
  }
}
