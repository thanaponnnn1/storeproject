import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, SerialStatus, TrackingType } from '@prisma/client';
import type { Tx } from '../costing/costing.types';

const D = Prisma.Decimal;

export interface TrackingInput {
  serials?: string[];
  lotNo?: string;
  lotId?: string;
  expiryDate?: string;
  soldToPartnerId?: string;
}

interface TrackedProduct {
  id: string;
  name: string;
  trackingType: TrackingType;
  warrantyMonths: number;
}

/**
 * ดูแล serial (แอร์/ตู้เย็น — ตามตัวรายเครื่อง) และ lot (ปูน/สี — มีวันหมดอายุ)
 *
 * ยอดคงเหลือราย lot ไม่มี cache — คำนวณจาก SUM(movements) เสมอ ตามหลักเดียวกับ ledger
 * ทุก method ถูกเรียกภายใน transaction ที่ lock แถว balance ไว้แล้ว
 */
@Injectable()
export class TrackingService {
  // ---------- รับเข้า ----------

  /** ตรวจ input + เตรียม lot ก่อนสร้าง movement รับเข้า */
  async prepareInflow(
    tx: Tx,
    product: TrackedProduct,
    warehouseId: string,
    qty: Prisma.Decimal,
    input: TrackingInput,
  ): Promise<{ lotId: string | null }> {
    switch (product.trackingType) {
      case TrackingType.NONE:
        this.assertNoTrackingData(input);
        return { lotId: null };

      case TrackingType.SERIAL: {
        const serials = this.normalizeSerials(input.serials);
        this.assertSerialCount(serials, qty, product.name);
        const existing = await tx.serialNumber.findMany({
          where: { serial: { in: serials } },
          select: { serial: true },
        });
        if (existing.length) {
          throw new ConflictException(
            `serial ซ้ำในระบบ: ${existing.map((e) => e.serial).join(', ')}`,
          );
        }
        return { lotId: null };
      }

      case TrackingType.LOT: {
        if (!input.lotNo?.trim()) {
          throw new BadRequestException(
            `สินค้า "${product.name}" ต้องระบุเลขล็อต (lotNo) ทุกครั้งที่รับเข้า`,
          );
        }
        const lotNo = input.lotNo.trim();
        const expiryDate = input.expiryDate
          ? new Date(input.expiryDate)
          : undefined;
        const lot = await tx.lot.upsert({
          where: { productId_lotNo: { productId: product.id, lotNo } },
          update: expiryDate ? { expiryDate } : {},
          create: {
            productId: product.id,
            lotNo,
            expiryDate,
            receivedAt: new Date(),
          },
        });
        return { lotId: lot.id };
      }
    }
  }

  /** หลังสร้าง movement รับเข้า — บันทึก serial ทุกเครื่องเข้าคลัง */
  async afterInflow(
    tx: Tx,
    product: TrackedProduct,
    movementId: string,
    warehouseId: string,
    input: TrackingInput,
  ): Promise<void> {
    if (product.trackingType !== TrackingType.SERIAL) return;
    const serials = this.normalizeSerials(input.serials);
    await tx.serialNumber.createMany({
      data: serials.map((serial) => ({
        productId: product.id,
        serial,
        warehouseId,
        status: SerialStatus.IN_STOCK,
        receiveMovementId: movementId,
      })),
    });
  }

  // ---------- จ่ายออก ----------

  /** ตรวจว่า serial/lot ที่จะจ่ายออกมีจริงและพร้อมจ่าย */
  async prepareOutflow(
    tx: Tx,
    product: TrackedProduct,
    warehouseId: string,
    qty: Prisma.Decimal,
    input: TrackingInput,
  ): Promise<{ lotId: string | null }> {
    switch (product.trackingType) {
      case TrackingType.NONE:
        this.assertNoTrackingData(input);
        return { lotId: null };

      case TrackingType.SERIAL: {
        const serials = this.normalizeSerials(input.serials);
        this.assertSerialCount(serials, qty, product.name);

        const found = await tx.serialNumber.findMany({
          where: { serial: { in: serials } },
        });
        const foundMap = new Map(found.map((s) => [s.serial, s]));

        const problems: string[] = [];
        for (const serial of serials) {
          const record = foundMap.get(serial);
          if (!record) {
            problems.push(`${serial}: ไม่มีในระบบ`);
          } else if (record.productId !== product.id) {
            problems.push(`${serial}: เป็นของสินค้าอื่น`);
          } else if (record.status !== SerialStatus.IN_STOCK) {
            problems.push(`${serial}: สถานะ ${record.status} (ไม่พร้อมจ่าย)`);
          } else if (record.warehouseId !== warehouseId) {
            problems.push(`${serial}: อยู่คนละคลัง`);
          }
        }
        if (problems.length) {
          throw new UnprocessableEntityException(
            `จ่ายออกไม่ได้ — ${problems.join(' / ')}`,
          );
        }
        return { lotId: null };
      }

      case TrackingType.LOT: {
        if (!input.lotId) {
          throw new BadRequestException(
            `สินค้า "${product.name}" ต้องระบุล็อตที่จะจ่าย (lotId) — ดูล็อตแนะนำจาก GET /inventory/lots (เรียงแบบ FEFO)`,
          );
        }
        const lot = await tx.lot.findUnique({ where: { id: input.lotId } });
        if (!lot || lot.productId !== product.id) {
          throw new NotFoundException('ไม่พบล็อตนี้ในสินค้าดังกล่าว');
        }
        const remaining = await this.lotRemaining(tx, lot.id, warehouseId);
        if (remaining.lessThan(qty)) {
          throw new UnprocessableEntityException(
            `ล็อต ${lot.lotNo} คงเหลือ ${remaining.toString()} ไม่พอจ่าย ${qty.toString()}`,
          );
        }
        return { lotId: lot.id };
      }
    }
  }

  /** หลังสร้าง movement จ่ายออก — ปิดการขาย serial + คำนวณวันหมดประกัน */
  async afterOutflow(
    tx: Tx,
    product: TrackedProduct,
    movementId: string,
    input: TrackingInput,
    soldAt: Date,
  ): Promise<void> {
    if (product.trackingType !== TrackingType.SERIAL) return;
    const serials = this.normalizeSerials(input.serials);

    await tx.serialNumber.updateMany({
      where: { serial: { in: serials } },
      data: {
        status: SerialStatus.SOLD,
        issueMovementId: movementId,
        soldToPartnerId: input.soldToPartnerId ?? null,
        soldAt,
        warrantyEnd: this.warrantyEnd(soldAt, product.warrantyMonths),
      },
    });
  }

  // ---------- กลับรายการ ----------

  /**
   * กลับรายการรับเข้า — ลบ serial ที่เพิ่งรับเข้า (ต้องยังไม่ถูกขาย)
   * ลบได้เพราะประวัติการรับ-ยกเลิกอยู่ใน ledger ครบแล้ว และการรับใหม่
   * ด้วย serial เดิม (เช่นคีย์ผิดแล้วทำใหม่) ต้องไม่ติด unique
   */
  async reverseInflow(
    tx: Tx,
    product: TrackedProduct,
    originalMovementId: string,
  ): Promise<void> {
    if (product.trackingType !== TrackingType.SERIAL) return;

    const serials = await tx.serialNumber.findMany({
      where: { receiveMovementId: originalMovementId },
    });
    const sold = serials.filter((s) => s.status !== SerialStatus.IN_STOCK);
    if (sold.length) {
      throw new UnprocessableEntityException(
        `ยกเลิกการรับเข้าไม่ได้ — เครื่องเหล่านี้ถูกจ่ายออกไปแล้ว: ${sold
          .map((s) => s.serial)
          .join(', ')} (ต้องกลับรายการการจ่ายออกก่อน)`,
      );
    }
    await tx.serialNumber.deleteMany({
      where: { receiveMovementId: originalMovementId },
    });
  }

  /** กลับรายการจ่ายออก — serial กลับเข้าคลัง ล้างข้อมูลการขาย/ประกัน */
  async reverseOutflow(
    tx: Tx,
    product: TrackedProduct,
    originalMovementId: string,
    warehouseId: string,
  ): Promise<void> {
    if (product.trackingType !== TrackingType.SERIAL) return;

    await tx.serialNumber.updateMany({
      where: { issueMovementId: originalMovementId },
      data: {
        status: SerialStatus.IN_STOCK,
        warehouseId,
        issueMovementId: null,
        soldToPartnerId: null,
        soldAt: null,
        warrantyEnd: null,
      },
    });
  }

  // ---------- helper ----------

  /** ยอดคงเหลือของล็อตในคลังหนึ่ง = SUM(movements) ของล็อตนั้น */
  async lotRemaining(
    tx: Tx,
    lotId: string,
    warehouseId: string,
  ): Promise<Prisma.Decimal> {
    const agg = await tx.stockMovement.aggregate({
      where: { lotId, warehouseId },
      _sum: { qty: true },
    });
    return agg._sum.qty ?? new D(0);
  }

  private warrantyEnd(soldAt: Date, months: number): Date | null {
    if (months <= 0) return null;
    const end = new Date(soldAt);
    end.setMonth(end.getMonth() + months);
    return end;
  }

  private normalizeSerials(serials?: string[]): string[] {
    return (serials ?? []).map((s) => s.trim()).filter(Boolean);
  }

  private assertSerialCount(
    serials: string[],
    qty: Prisma.Decimal,
    productName: string,
  ): void {
    if (!qty.isInteger()) {
      throw new BadRequestException(
        `สินค้า "${productName}" นับเป็นเครื่อง จำนวนต้องเป็นจำนวนเต็ม`,
      );
    }
    if (new Set(serials).size !== serials.length) {
      throw new BadRequestException('มี serial ซ้ำกันในรายการที่ส่งมา');
    }
    if (!qty.equals(serials.length)) {
      throw new UnprocessableEntityException(
        `จำนวน serial (${serials.length}) ต้องเท่ากับจำนวนสินค้า (${qty.toString()}) — สินค้า "${productName}" ต้องยิง serial ทุกเครื่อง`,
      );
    }
  }

  private assertNoTrackingData(input: TrackingInput): void {
    if (input.serials?.length || input.lotNo || input.lotId) {
      throw new BadRequestException(
        'สินค้านี้ไม่ได้ตั้งค่าให้ติดตาม serial หรือ lot — ห้ามส่งข้อมูลเหล่านี้มา',
      );
    }
  }
}
