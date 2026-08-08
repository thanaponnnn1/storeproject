import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PriceLevel, Prisma } from '@prisma/client';
import type { RoleName } from '../../common/decorators/roles.decorator';
import type { Tx } from '../../inventory/costing/costing.types';

const D = Prisma.Decimal;

/** role ที่แก้ราคาหน้าบิลได้ — พนักงานขายทั่วไปต้องใช้ราคาตามระดับลูกค้า */
const PRICE_OVERRIDE_ROLES: RoleName[] = ['ADMIN', 'MANAGER'];

export interface LineInput {
  productId: string;
  productUnitId?: string;
  qty: number;
  unitPrice?: number;
  discount?: number;
}

export interface PricedLine {
  lineNo: number;
  productId: string;
  productUnitId: string | null;
  qty: Prisma.Decimal;
  baseQty: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

export interface DocTotals {
  subtotal: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

@Injectable()
export class PricingService {
  /**
   * แปลงรายการที่ผู้ใช้ส่งมาเป็นบรรทัดเอกสารที่คิดราคาแล้ว
   *
   * ราคาที่ได้มาจากระดับราคาของลูกค้า (ปลีก/ช่าง/โครงการ) โดยอัตโนมัติ
   * ถ้าส่ง unitPrice มาเอง = แก้ราคาหน้าบิล ต้องมีสิทธิ์เท่านั้น
   */
  async priceLines(
    tx: Tx,
    lines: LineInput[],
    priceLevel: PriceLevel,
    userRole: RoleName,
  ): Promise<PricedLine[]> {
    if (!lines.length) {
      throw new BadRequestException('เอกสารต้องมีอย่างน้อย 1 รายการ');
    }

    const priced: PricedLine[] = [];
    for (const [index, line] of lines.entries()) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        include: { units: true },
      });
      if (!product || !product.isActive) {
        throw new NotFoundException(
          `ไม่พบสินค้าในรายการที่ ${index + 1} หรือสินค้าถูกปิดใช้งาน`,
        );
      }

      const unit = line.productUnitId
        ? product.units.find((u) => u.id === line.productUnitId)
        : null;
      if (line.productUnitId && !unit) {
        throw new BadRequestException(
          `รายการที่ ${index + 1}: หน่วยขายไม่ใช่ของสินค้านี้`,
        );
      }

      const factor = unit ? unit.conversionFactor : new D(1);
      const qty = new D(line.qty);
      const unitPrice = this.resolveUnitPrice(
        { priceRetail: product.priceRetail, priceContractor: product.priceContractor, priceProject: product.priceProject },
        unit ? { salePrice: unit.salePrice, conversionFactor: unit.conversionFactor } : null,
        priceLevel,
        line.unitPrice,
        userRole,
      );
      const discount = new D(line.discount ?? 0);
      const lineTotal = qty.mul(unitPrice).sub(discount).toDecimalPlaces(2);
      if (lineTotal.lessThan(0)) {
        throw new BadRequestException(
          `รายการที่ ${index + 1}: ส่วนลดมากกว่ามูลค่าสินค้า`,
        );
      }

      priced.push({
        lineNo: index + 1,
        productId: product.id,
        productUnitId: unit?.id ?? null,
        qty,
        baseQty: qty.mul(factor).toDecimalPlaces(3),
        unitPrice,
        discount,
        lineTotal,
      });
    }
    return priced;
  }

  /**
   * ราคาต่อหน่วยขาย:
   *  - ลูกค้าปลีก + หน่วยนั้นมีราคาป้าย → ใช้ราคาป้าย (ยกมัดถูกกว่าซื้อทีละเส้น)
   *  - นอกนั้น → ราคาตามระดับลูกค้า (ต่อหน่วยฐาน) × ตัวคูณหน่วย
   */
  private resolveUnitPrice(
    prices: {
      priceRetail: Prisma.Decimal;
      priceContractor: Prisma.Decimal;
      priceProject: Prisma.Decimal;
    },
    unit: { salePrice: Prisma.Decimal | null; conversionFactor: Prisma.Decimal } | null,
    priceLevel: PriceLevel,
    explicitPrice: number | undefined,
    userRole: RoleName,
  ): Prisma.Decimal {
    if (explicitPrice !== undefined) {
      if (!PRICE_OVERRIDE_ROLES.includes(userRole)) {
        throw new ForbiddenException(
          'แก้ราคาหน้าบิลไม่ได้ — ต้องเป็นผู้จัดการขึ้นไป (ราคาจะถูกดึงตามระดับลูกค้าให้อัตโนมัติ)',
        );
      }
      return new D(explicitPrice);
    }

    if (priceLevel === PriceLevel.RETAIL && unit?.salePrice) {
      return unit.salePrice;
    }

    const basePrice =
      priceLevel === PriceLevel.CONTRACTOR
        ? prices.priceContractor
        : priceLevel === PriceLevel.PROJECT
          ? prices.priceProject
          : prices.priceRetail;

    return unit
      ? basePrice.mul(unit.conversionFactor).toDecimalPlaces(2)
      : basePrice;
  }

  /**
   * บรรทัดเอกสารฝั่งซื้อ — ใช้ "ทุนที่ซัพพลายเออร์เสนอ" ที่ผู้ใช้กรอกเอง
   * ไม่มีการดึงราคาอัตโนมัติเหมือนฝั่งขาย (ราคาซื้อต่อรองกันทุกครั้ง)
   */
  async costLines(
    tx: Tx,
    lines: (LineInput & { unitCost: number })[],
  ): Promise<(PricedLine & { unitCost: Prisma.Decimal })[]> {
    if (!lines.length) {
      throw new BadRequestException('เอกสารต้องมีอย่างน้อย 1 รายการ');
    }

    const priced: (PricedLine & { unitCost: Prisma.Decimal })[] = [];
    for (const [index, line] of lines.entries()) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        include: { units: true },
      });
      if (!product || !product.isActive) {
        throw new NotFoundException(
          `ไม่พบสินค้าในรายการที่ ${index + 1} หรือสินค้าถูกปิดใช้งาน`,
        );
      }
      const unit = line.productUnitId
        ? product.units.find((u) => u.id === line.productUnitId)
        : null;
      if (line.productUnitId && !unit) {
        throw new BadRequestException(
          `รายการที่ ${index + 1}: หน่วยซื้อไม่ใช่ของสินค้านี้`,
        );
      }

      const factor = unit ? unit.conversionFactor : new D(1);
      const qty = new D(line.qty);
      const unitCost = new D(line.unitCost);
      const discount = new D(line.discount ?? 0);
      const lineTotal = qty.mul(unitCost).sub(discount).toDecimalPlaces(2);
      if (lineTotal.lessThan(0)) {
        throw new BadRequestException(
          `รายการที่ ${index + 1}: ส่วนลดมากกว่ามูลค่าสินค้า`,
        );
      }

      priced.push({
        lineNo: index + 1,
        productId: product.id,
        productUnitId: unit?.id ?? null,
        qty,
        baseQty: qty.mul(factor).toDecimalPlaces(3),
        unitPrice: unitCost,
        unitCost,
        discount,
        lineTotal,
      });
    }
    return priced;
  }

  /** ราคาในเอกสารเป็นราคาก่อน VAT — บวก VAT ตอนสรุปยอด */
  totals(lines: { lineTotal: Prisma.Decimal }[], vatRate: Prisma.Decimal): DocTotals {
    const subtotal = lines
      .reduce((sum, l) => sum.add(l.lineTotal), new D(0))
      .toDecimalPlaces(2);
    const vatAmount = subtotal.mul(vatRate).div(100).toDecimalPlaces(2);
    return {
      subtotal,
      vatAmount,
      totalAmount: subtotal.add(vatAmount),
    };
  }
}
