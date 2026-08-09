import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CostingMethod, Prisma } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { rethrowPrismaError } from '../../common/prisma-error';
import { InventoryService } from '../../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../../uploads/uploads.service';
import {
  ConvertQtyDto,
  CreateBarcodeDto,
  CreateProductDto,
  CreateProductUnitDto,
  QueryProductsDto,
  UpdateProductDto,
} from './products.dto';

const productInclude = {
  category: true,
  baseUom: true,
  units: { where: { isActive: true }, include: { uom: true } },
  barcodes: { include: { productUnit: { include: { uom: true } } } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly uploads: UploadsService,
  ) {}

  async findAll(query: QueryProductsDto) {
    const where: Prisma.ProductWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.trackingType ? { trackingType: query.trackingType } : {}),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { brand: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
              // ยิงบาร์โค้ดใส่ช่องค้นหาแล้วต้องเจอด้วย — หน้างานจะได้ไม่ต้องจำว่า
              // ช่องไหนใช้ค้นชื่อ ช่องไหนใช้ยิงบาร์โค้ด
              {
                barcodes: {
                  some: {
                    barcode: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: { category: true, baseUom: true },
        orderBy: { sku: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    return {
      ...product,
      imageUrl: this.uploads.imageUrl(product.imagePublicId),
    };
  }

  async create(dto: CreateProductDto) {
    const { units, ...data } = dto;
    try {
      return await this.prisma.product.create({
        data: {
          ...data,
          units: units?.length ? { create: units } : undefined,
        },
        include: productInclude,
      });
    } catch (e) {
      rethrowPrismaError(e, 'สินค้า');
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    const before = await this.prisma.product.findUnique({
      where: { id },
      select: { costingMethod: true },
    });
    if (!before) throw new NotFoundException('ไม่พบสินค้า');

    let updated;
    try {
      updated = await this.prisma.product.update({
        where: { id },
        data: dto,
        include: productInclude,
      });
    } catch (e) {
      rethrowPrismaError(e, 'สินค้า');
    }

    // สลับมาใช้ FIFO ตอนที่ของยังอยู่ในคลัง → ต้องตั้ง layer ยอดยกมา
    // ไม่งั้นยอดคงเหลือมีของแต่ layer ว่าง จ่ายออกไม่ได้
    if (
      dto.costingMethod === CostingMethod.FIFO &&
      before.costingMethod !== CostingMethod.FIFO
    ) {
      await this.inventory.ensureFifoOpeningLayers(id);
    }
    return updated;
  }

  async addUnit(productId: string, dto: CreateProductUnitDto) {
    await this.findOne(productId);
    try {
      return await this.prisma.productUnit.create({
        data: { productId, ...dto },
        include: { uom: true },
      });
    } catch (e) {
      rethrowPrismaError(e, 'หน่วยขายของสินค้า');
    }
  }

  /**
   * เพิ่ม barcode ให้สินค้า — ไม่ส่ง barcode มา = generate QR ภายใน
   * รูปแบบภายใน: INT:<SKU>:<UOM_CODE> (พิมพ์เป็นสติกเกอร์ QR ติดชั้นวาง)
   */
  async addBarcode(productId: string, dto: CreateBarcodeDto) {
    const product = await this.findOne(productId);

    let uomCode = product.baseUom.code;
    if (dto.productUnitId) {
      const unit = product.units.find((u) => u.id === dto.productUnitId);
      if (!unit) {
        throw new BadRequestException(
          'productUnitId ไม่ใช่หน่วยขายของสินค้านี้',
        );
      }
      uomCode = unit.uom.code;
    }

    const isInternal = !dto.barcode;
    const barcode = dto.barcode ?? `INT:${product.sku}:${uomCode}`;
    try {
      return await this.prisma.productBarcode.create({
        data: {
          productId,
          productUnitId: dto.productUnitId,
          barcode,
          isInternal,
        },
      });
    } catch (e) {
      rethrowPrismaError(e, 'barcode');
    }
  }

  /**
   * Lookup หน้างาน: ยิง barcode → สินค้า + หน่วยของ barcode นั้น + ตัวคูณ
   * + ยอดคงเหลือรายคลัง (ทั้งหน่วยฐานและหน่วยที่ยิง)
   */
  async findByBarcode(code: string) {
    const found = await this.prisma.productBarcode.findUnique({
      where: { barcode: code },
      include: {
        product: { include: { baseUom: true, category: true } },
        productUnit: { include: { uom: true } },
      },
    });
    if (!found || !found.product.isActive) {
      throw new NotFoundException('ไม่พบสินค้าจาก barcode นี้');
    }

    const scannedUnit = found.productUnit
      ? {
          productUnitId: found.productUnit.id,
          uom: found.productUnit.uom,
          conversionFactor: found.productUnit.conversionFactor,
          salePrice: found.productUnit.salePrice,
        }
      : {
          productUnitId: null,
          uom: found.product.baseUom,
          conversionFactor: new Prisma.Decimal(1),
          salePrice: found.product.priceRetail,
        };

    const balances = await this.prisma.stockBalance.findMany({
      where: { productId: found.productId },
      include: { warehouse: { select: { code: true, name: true } } },
    });
    const stock = balances.map((b) => ({
      warehouse: b.warehouse,
      qtyOnHand: b.qtyOnHand, // หน่วยฐาน
      qtyInScannedUnit: b.qtyOnHand
        .div(scannedUnit.conversionFactor)
        .toDecimalPlaces(3), // แปลงเป็นหน่วยที่ยิง (12 มัด จาก 120 เส้น)
      avgCost: b.avgCost,
    }));

    return { product: found.product, scannedUnit, stock };
  }

  /** แปลงจำนวนจากหน่วยขาย → หน่วยฐาน (2 มัด → 20 เส้น) */
  async convert(productId: string, dto: ConvertQtyDto) {
    const product = await this.findOne(productId);

    if (dto.uomId === product.baseUomId) {
      return {
        qty: dto.qty,
        uom: product.baseUom,
        baseQty: new Prisma.Decimal(dto.qty),
        baseUom: product.baseUom,
      };
    }

    const unit = product.units.find((u) => u.uomId === dto.uomId);
    if (!unit) {
      throw new BadRequestException('หน่วยนี้ไม่ใช่หน่วยขายของสินค้านี้');
    }
    return {
      qty: dto.qty,
      uom: unit.uom,
      baseQty: unit.conversionFactor.mul(dto.qty),
      baseUom: product.baseUom,
    };
  }
}
