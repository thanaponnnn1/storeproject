import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotationsService } from '../documents/quotations/quotations.service';
import { ReportsService } from '../documents/reports/reports.service';

/**
 * งานประจำที่ระบบทำให้เอง — ใช้ @nestjs/schedule ไม่ต้องมี infra เพิ่ม
 *
 * ปิดได้ด้วย CRON_ENABLED=false (จำเป็นตอนรันหลาย instance ไม่งั้นงานจะซ้ำ
 * — เฟส 8 จะย้ายไปเป็น job queue ที่มีตัวล็อกกลาง)
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly quotations: QuotationsService,
    private readonly reports: ReportsService,
  ) {
    this.enabled = config.get<boolean>('CRON_ENABLED') ?? true;
  }

  /** ตี 2 ทุกคืน: ตรวจกระทบยอด cache vs ledger — เพี้ยนเมื่อไหร่ต้องรู้ก่อนลูกค้า */
  @Cron('0 2 * * *', { name: 'reconcile' })
  async nightlyReconcile(): Promise<void> {
    if (!this.enabled) return;
    const result = await this.inventory.reconcile();
    if (result.clean) {
      this.logger.log(
        `reconcile ผ่าน: ตรวจ ${result.balancesChecked} รายการ ไม่พบยอดเพี้ยน`,
      );
      return;
    }
    // ยอดเพี้ยน = เรื่องใหญ่ ต้องเด้ง alert (เฟส 8 ต่อเข้า Sentry/LINE)
    this.logger.error(
      `⚠️ reconcile พบยอดไม่ตรง ${result.mismatches.length} รายการ: ` +
        JSON.stringify(result.mismatches),
    );
  }

  /** ทุกวัน 01:00: ใบเสนอราคาที่เลยวันยืนราคา → EXPIRED */
  @Cron('0 1 * * *', { name: 'expire-quotations' })
  async expireQuotations(): Promise<void> {
    if (!this.enabled) return;
    const { expired } = await this.quotations.expireOverdue();
    if (expired > 0) {
      this.logger.log(`ใบเสนอราคาหมดอายุ ${expired} ใบ`);
    }
  }

  /** ทุกเช้า 08:00: แจ้งของใกล้หมด + ล็อตใกล้หมดอายุ + หนี้เกินกำหนด */
  @Cron('0 8 * * *', { name: 'daily-alerts' })
  async dailyAlerts(): Promise<void> {
    if (!this.enabled) return;
    await this.runDailyAlerts();
  }

  /** แยกไว้ให้เรียกทดสอบ/ยิงเองได้โดยไม่ต้องรอเวลา */
  async runDailyAlerts() {
    const [lowStock, expiring, aging] = await Promise.all([
      this.reports.lowStock(),
      this.inventory.expiringLots({ days: 30 }),
      this.reports.arAging(),
    ]);

    if (lowStock.length) {
      this.logger.warn(
        `สินค้าต่ำกว่าจุดสั่งซื้อ ${lowStock.length} รายการ: ` +
          lowStock
            .slice(0, 5)
            .map((i) => `${i.sku} เหลือ ${i.qtyOnHand}/${i.minStock}`)
            .join(', '),
      );
    }
    if (expiring.lots.length) {
      this.logger.warn(
        `ล็อตใกล้หมดอายุใน 30 วัน ${expiring.lots.length} ล็อต: ` +
          expiring.lots
            .slice(0, 5)
            .map((l) => `${l.sku} ${l.lotNo} อีก ${l.daysToExpiry} วัน`)
            .join(', '),
      );
    }
    const overdue = aging.items.filter((i) => i.daysOverdue > 0);
    if (overdue.length) {
      this.logger.warn(
        `ลูกหนี้เกินกำหนด ${overdue.length} ใบ รวม ${aging.buckets.d1to30
          .add(aging.buckets.d31to60)
          .add(aging.buckets.d61to90)
          .add(aging.buckets.over90)
          .toString()} บาท`,
      );
    }

    return {
      lowStockCount: lowStock.length,
      expiringLotCount: expiring.lots.length,
      overdueInvoiceCount: overdue.length,
    };
  }

  /** ทุกชั่วโมง: ล้าง refresh token ที่หมดอายุ/ถูก revoke เกิน 30 วัน */
  @Cron(CronExpression.EVERY_HOUR, { name: 'cleanup-tokens' })
  async cleanupTokens(): Promise<void> {
    if (!this.enabled) return;
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });
    if (count > 0) this.logger.log(`ล้าง refresh token หมดอายุ ${count} รายการ`);
  }
}
