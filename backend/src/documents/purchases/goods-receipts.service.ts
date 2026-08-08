import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  GoodsReceiptStatus,
  Prisma,
  PurchaseOrderStatus,
  TrackingType,
} from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { InventoryService } from '../../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { assertTransition } from '../core/state-machine';
import { CreateGoodsReceiptDto, QueryDocsDto } from '../documents.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

const D = Prisma.Decimal;

const grInclude = {
  partner: { select: { code: true, name: true } },
  warehouse: { select: { code: true, name: true } },
  purchaseOrder: { select: { id: true, docNo: true, status: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true, trackingType: true } },
      productUnit: { include: { uom: { select: { code: true, name: true } } } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.GoodsReceiptInclude;

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly inventory: InventoryService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {}

  /** สร้างใบรับของจากใบสั่งซื้อ — รับบางส่วนได้ ยังไม่เข้าสต๊อกจนกว่าจะยืนยัน */
  async create(dto: CreateGoodsReceiptDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
        include: { lines: { include: { product: true, productUnit: true } } },
      });
      if (!po) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
      if (
        po.status === PurchaseOrderStatus.DRAFT ||
        po.status === PurchaseOrderStatus.CANCELLED ||
        po.status === PurchaseOrderStatus.CLOSED
      ) {
        throw new UnprocessableEntityException(
          `รับของจากใบสั่งซื้อสถานะ ${po.status} ไม่ได้ (ต้องอนุมัติใบสั่งซื้อก่อน)`,
        );
      }

      const lines = dto.lines.map((input, index) => {
        const poLine = po.lines.find((l) => l.id === input.poLineId);
        if (!poLine) {
          throw new BadRequestException(
            `รายการที่ ${index + 1}: ไม่ใช่บรรทัดของใบสั่งซื้อนี้`,
          );
        }
        const factor = poLine.productUnit?.conversionFactor ?? new D(1);
        const qty = new D(input.qty);
        const baseQty = qty.mul(factor).toDecimalPlaces(3);

        const remaining = poLine.baseQty.sub(poLine.qtyReceived);
        if (baseQty.greaterThan(remaining)) {
          throw new UnprocessableEntityException(
            `รายการที่ ${index + 1} (${poLine.product.sku}): รับได้อีกแค่ ${remaining.toString()} (สั่ง ${poLine.baseQty.toString()} รับแล้ว ${poLine.qtyReceived.toString()})`,
          );
        }

        this.assertTrackingInput(
          poLine.product.trackingType,
          input,
          baseQty,
          index,
        );

        // ทุนจริงอาจต่างจากใบสั่งซื้อ (ของขึ้นราคา) — ทุนที่เข้าสต๊อกใช้ของจริงเสมอ
        const unitCost =
          input.unitCost !== undefined ? new D(input.unitCost) : poLine.unitCost;

        return {
          lineNo: index + 1,
          productId: poLine.productId,
          productUnitId: poLine.productUnitId,
          qty,
          baseQty,
          unitCost,
          lineTotal: qty.mul(unitCost).toDecimalPlaces(2),
          serials: input.serials ?? [],
          lotNo: input.lotNo ?? null,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          sourceLineId: poLine.id,
        };
      });

      return tx.goodsReceipt.create({
        data: {
          docNo: await this.docNumber.next(tx, 'GR'),
          partnerId: po.partnerId,
          purchaseOrderId: po.id,
          warehouseId: po.warehouseId,
          supplierRef: dto.supplierRef,
          remark: dto.remark,
          createdBy: userId,
          lines: { create: lines },
        },
        include: grInclude,
      });
    });
  }

  /**
   * ยืนยันใบรับของ = ของเข้าสต๊อกจริง
   *
   * transaction เดียวกันทำครบ: post RECEIVE ลง ledger + สร้าง cost layer (FIFO)
   * หรือคิดทุนเฉลี่ยใหม่ (AVG) + บันทึก serial/lot + อัปเดตยอดรับสะสมบนใบสั่งซื้อ
   */
  async confirm(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.findUnique({
        where: { id },
        include: { lines: { include: { productUnit: true } } },
      });
      if (!receipt) throw new NotFoundException('ไม่พบใบรับของ');
      assertTransition('GR', receipt.status, GoodsReceiptStatus.CONFIRMED);

      for (const line of receipt.lines) {
        // ทุนในเอกสารเป็นทุน "ต่อหน่วยที่ซื้อ" (เช่น 440 บาท/มัด) แต่ ledger
        // เก็บทุกอย่างเป็นหน่วยฐาน จึงต้องหารด้วยตัวคูณก่อน (44 บาท/เส้น)
        const factor = line.productUnit?.conversionFactor ?? new D(1);
        const baseUnitCost = line.unitCost.div(factor).toDecimalPlaces(4);

        const movement = await this.inventory.receiveInTx(
          tx,
          {
            productId: line.productId,
            warehouseId: receipt.warehouseId,
            qty: line.baseQty.toNumber(),
            unitCost: baseUnitCost.toNumber(),
            refDocType: 'GR',
            refDocId: receipt.docNo,
            serials: line.serials.length ? line.serials : undefined,
            lotNo: line.lotNo ?? undefined,
            expiryDate: line.expiryDate?.toISOString(),
            note: `รับของตาม ${receipt.docNo}`,
          },
          userId,
        );

        await tx.goodsReceiptLine.update({
          where: { id: line.id },
          data: { movementId: movement.id },
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.sourceLineId },
          data: { qtyReceived: { increment: line.baseQty } },
        });
      }

      const updated = await tx.goodsReceipt.update({
        where: { id },
        data: {
          status: GoodsReceiptStatus.CONFIRMED,
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
        include: grInclude,
      });

      await this.purchaseOrders.syncReceiveStatus(tx, receipt.purchaseOrderId);
      return updated;
    });
  }

  /**
   * ยกเลิกใบรับของ — ยืนยันแล้วต้องกลับรายการใน ledger
   * ถ้าของถูกขายออกไปแล้ว จะโดนกันที่ชั้น cost layer / serial (ต้องกลับรายการขายก่อน)
   */
  async cancel(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!receipt) throw new NotFoundException('ไม่พบใบรับของ');
      assertTransition('GR', receipt.status, GoodsReceiptStatus.CANCELLED);

      if (receipt.status === GoodsReceiptStatus.CONFIRMED) {
        for (const line of receipt.lines) {
          if (!line.movementId) continue;
          await this.inventory.reverseInTx(tx, line.movementId, userId);
          await tx.purchaseOrderLine.update({
            where: { id: line.sourceLineId },
            data: { qtyReceived: { decrement: line.baseQty } },
          });
        }
      }

      const updated = await tx.goodsReceipt.update({
        where: { id },
        data: {
          status: GoodsReceiptStatus.CANCELLED,
          cancelledBy: userId,
          cancelledAt: new Date(),
        },
        include: grInclude,
      });

      await this.purchaseOrders.syncReceiveStatus(tx, receipt.purchaseOrderId);
      return updated;
    });
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.GoodsReceiptWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.status ? { status: query.status as GoodsReceiptStatus } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.goodsReceipt.findMany({
        where,
        include: {
          partner: { select: { code: true, name: true } },
          purchaseOrder: { select: { docNo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      include: grInclude,
    });
    if (!receipt) throw new NotFoundException('ไม่พบใบรับของ');
    return receipt;
  }

  private assertTrackingInput(
    trackingType: TrackingType,
    input: { serials?: string[]; lotNo?: string },
    baseQty: Prisma.Decimal,
    index: number,
  ): void {
    if (trackingType === TrackingType.SERIAL) {
      const count = input.serials?.length ?? 0;
      if (!baseQty.equals(count)) {
        throw new UnprocessableEntityException(
          `รายการที่ ${index + 1}: ต้องคีย์ serial ให้ครบ ${baseQty.toString()} เครื่อง (คีย์มา ${count})`,
        );
      }
    }
    if (trackingType === TrackingType.LOT && !input.lotNo?.trim()) {
      throw new BadRequestException(
        `รายการที่ ${index + 1}: สินค้าชนิดนี้ต้องระบุเลขล็อตและวันหมดอายุตอนรับเข้า`,
      );
    }
  }
}
