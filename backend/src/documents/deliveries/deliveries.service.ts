import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma, SalesOrderStatus, TrackingType } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { InventoryService } from '../../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from '../core/doc-number.service';
import { assertTransition } from '../core/state-machine';
import { CreateDeliveryDto, QueryDocsDto } from '../documents.dto';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';

const D = Prisma.Decimal;

const doInclude = {
  partner: { select: { code: true, name: true } },
  warehouse: { select: { code: true, name: true } },
  salesOrder: { select: { id: true, docNo: true, status: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true, trackingType: true } },
      productUnit: { include: { uom: { select: { code: true, name: true } } } },
      lot: { select: { lotNo: true, expiryDate: true } },
    },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.DeliveryOrderInclude;

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly inventory: InventoryService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  /**
   * สร้างใบส่งของจากใบสั่งขาย — เลือกส่งบางรายการ/บางจำนวนได้
   * ตอนนี้ยังไม่ตัดสต๊อก (เป็นฉบับร่าง) แต่กันไว้ไม่ให้ส่งเกินยอดค้างส่ง
   */
  async create(dto: CreateDeliveryDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUnique({
        where: { id: dto.salesOrderId },
        include: { lines: { include: { product: true, productUnit: true } } },
      });
      if (!so) throw new NotFoundException('ไม่พบใบสั่งขาย');
      if (
        so.status === SalesOrderStatus.DRAFT ||
        so.status === SalesOrderStatus.CANCELLED ||
        so.status === SalesOrderStatus.CLOSED
      ) {
        throw new UnprocessableEntityException(
          `ออกใบส่งของจากใบสั่งขายสถานะ ${so.status} ไม่ได้ (ต้องยืนยันใบสั่งขายก่อน)`,
        );
      }

      const lines = dto.lines.map((input, index) => {
        const soLine = so.lines.find((l) => l.id === input.soLineId);
        if (!soLine) {
          throw new BadRequestException(
            `รายการที่ ${index + 1}: ไม่ใช่บรรทัดของใบสั่งขายนี้`,
          );
        }
        const factor = soLine.productUnit?.conversionFactor ?? new D(1);
        const qty = new D(input.qty);
        const baseQty = qty.mul(factor).toDecimalPlaces(3);

        // ห้ามส่งเกินยอดค้างส่งของบรรทัดนั้น
        const remaining = soLine.baseQty.sub(soLine.qtyDelivered);
        if (baseQty.greaterThan(remaining)) {
          throw new UnprocessableEntityException(
            `รายการที่ ${index + 1} (${soLine.product.sku}): ส่งได้อีกแค่ ${remaining.toString()} (สั่ง ${soLine.baseQty.toString()} ส่งแล้ว ${soLine.qtyDelivered.toString()})`,
          );
        }

        this.assertTrackingInput(soLine.product.trackingType, input, baseQty, index);

        return {
          lineNo: index + 1,
          productId: soLine.productId,
          productUnitId: soLine.productUnitId,
          qty,
          baseQty,
          unitPrice: soLine.unitPrice,
          discount: new D(0),
          lineTotal: qty.mul(soLine.unitPrice).toDecimalPlaces(2),
          serials: input.serials ?? [],
          lotId: input.lotId ?? null,
          sourceLineId: soLine.id,
        };
      });

      return tx.deliveryOrder.create({
        data: {
          docNo: await this.docNumber.next(tx, 'DO'),
          partnerId: so.partnerId,
          salesOrderId: so.id,
          warehouseId: so.warehouseId,
          remark: dto.remark,
          createdBy: userId,
          lines: { create: lines },
        },
        include: doInclude,
      });
    });
  }

  /**
   * ยืนยันใบส่งของ = ตัดสต๊อกจริง
   *
   * ทุกอย่างอยู่ใน transaction เดียว: post ISSUE ทุกบรรทัด + อัปเดตยอดส่งสะสม
   * บน SO + เปลี่ยนสถานะทั้งสองใบ — ของไม่พอบรรทัดใดบรรทัดหนึ่ง = ล้มทั้งใบ
   * ไม่มีทางเกิดสภาพ "ส่งไปครึ่งใบแล้วค้าง"
   */
  async confirm(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveryOrder.findUnique({
        where: { id },
        include: { lines: { include: { product: true } } },
      });
      if (!delivery) throw new NotFoundException('ไม่พบใบส่งของ');
      assertTransition('DO', delivery.status, DeliveryStatus.CONFIRMED);

      for (const line of delivery.lines) {
        const movement = await this.inventory.issueInTx(
          tx,
          {
            productId: line.productId,
            warehouseId: delivery.warehouseId,
            qty: line.baseQty.toNumber(),
            refDocType: 'DO',
            refDocId: delivery.docNo,
            serials: line.serials.length ? line.serials : undefined,
            lotId: line.lotId ?? undefined,
            soldToPartnerId: delivery.partnerId,
            note: `ส่งของตาม ${delivery.docNo}`,
          },
          userId,
        );

        await tx.deliveryOrderLine.update({
          where: { id: line.id },
          data: { movementId: movement.id },
        });
        await tx.salesOrderLine.update({
          where: { id: line.sourceLineId },
          data: { qtyDelivered: { increment: line.baseQty } },
        });
      }

      const updated = await tx.deliveryOrder.update({
        where: { id },
        data: {
          status: DeliveryStatus.CONFIRMED,
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
        include: doInclude,
      });

      await this.salesOrders.syncDeliveryStatus(tx, delivery.salesOrderId);
      return updated;
    });
  }

  /**
   * ยกเลิกใบส่งของ — ถ้ายืนยันไปแล้วต้องกลับรายการใน ledger (ไม่ลบ movement)
   * และคืนยอดส่งสะสมบนใบสั่งขายให้ส่งใหม่ได้
   */
  async cancel(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveryOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!delivery) throw new NotFoundException('ไม่พบใบส่งของ');
      assertTransition('DO', delivery.status, DeliveryStatus.CANCELLED);

      if (delivery.status === DeliveryStatus.CONFIRMED) {
        const invoiced = await tx.invoiceLine.count({
          where: { deliveryOrderId: id, invoice: { status: { not: 'VOID' } } },
        });
        if (invoiced > 0) {
          throw new UnprocessableEntityException(
            'ใบส่งของนี้ถูกวางบิลแล้ว — ต้องยกเลิกใบแจ้งหนี้ก่อน',
          );
        }

        for (const line of delivery.lines) {
          if (!line.movementId) continue;
          await this.inventory.reverseInTx(tx, line.movementId, userId);
          await tx.salesOrderLine.update({
            where: { id: line.sourceLineId },
            data: { qtyDelivered: { decrement: line.baseQty } },
          });
        }
      }

      const updated = await tx.deliveryOrder.update({
        where: { id },
        data: {
          status: DeliveryStatus.CANCELLED,
          cancelledBy: userId,
          cancelledAt: new Date(),
        },
        include: doInclude,
      });

      await this.salesOrders.syncDeliveryStatus(tx, delivery.salesOrderId);
      return updated;
    });
  }

  async findAll(query: QueryDocsDto) {
    const where: Prisma.DeliveryOrderWhereInput = {
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.status ? { status: query.status as DeliveryStatus } : {}),
      ...(query.search
        ? { docNo: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.deliveryOrder.findMany({
        where,
        include: {
          partner: { select: { code: true, name: true } },
          salesOrder: { select: { docNo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.deliveryOrder.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const delivery = await this.prisma.deliveryOrder.findUnique({
      where: { id },
      include: doInclude,
    });
    if (!delivery) throw new NotFoundException('ไม่พบใบส่งของ');
    return delivery;
  }

  /** สินค้าที่ต้องตามตัวต้องระบุ serial/lot ตั้งแต่ตอนสร้างใบส่งของ */
  private assertTrackingInput(
    trackingType: TrackingType,
    input: { serials?: string[]; lotId?: string },
    baseQty: Prisma.Decimal,
    index: number,
  ): void {
    if (trackingType === TrackingType.SERIAL) {
      const count = input.serials?.length ?? 0;
      if (!baseQty.equals(count)) {
        throw new UnprocessableEntityException(
          `รายการที่ ${index + 1}: ต้องเลือก serial ให้ครบ ${baseQty.toString()} เครื่อง (เลือกมา ${count})`,
        );
      }
    }
    if (trackingType === TrackingType.LOT && !input.lotId) {
      throw new BadRequestException(
        `รายการที่ ${index + 1}: ต้องระบุล็อตที่จะจ่าย (ดูล็อตแนะนำแบบ FEFO จาก /inventory/lots)`,
      );
    }
  }
}
