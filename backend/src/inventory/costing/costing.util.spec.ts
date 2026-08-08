import { Prisma } from '@prisma/client';
import { allocateFifo, applyMovingAverage } from './costing.util';

const D = (n: number | string) => new Prisma.Decimal(n);

/** ช่วยสร้าง layer อ่านง่าย: layer('L1', เหลือ, ทุน) */
const layer = (id: string, remainingQty: number, unitCost: number) => ({
  id,
  remainingQty: D(remainingQty),
  unitCost: D(unitCost),
});

describe('allocateFifo', () => {
  it('เคสตามโจทย์: รับ 10@100, 10@120, 10@150 จ่าย 25 → ทุนรวม 2,950', () => {
    const result = allocateFifo(
      [layer('L1', 10, 100), layer('L2', 10, 120), layer('L3', 10, 150)],
      D(25),
    );

    expect(result.totalCost.toNumber()).toBe(2950);
    expect(result.unitCost.toNumber()).toBe(118); // 2950 / 25
    expect(result.shortage.toNumber()).toBe(0);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toMatchObject({ layerId: 'L1' });
    expect(result.lines[0]!.qty.toNumber()).toBe(10);
    expect(result.lines[1]!.qty.toNumber()).toBe(10);
    // layer ที่สามถูกกินแค่ 5 → เหลือ 5
    expect(result.lines[2]!.qty.toNumber()).toBe(5);
  });

  it('จ่ายพอดีหนึ่ง layer → กินก้อนเดียว ไม่แตะก้อนถัดไป', () => {
    const result = allocateFifo([layer('L1', 10, 100), layer('L2', 10, 200)], D(10));

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.layerId).toBe('L1');
    expect(result.totalCost.toNumber()).toBe(1000);
    expect(result.unitCost.toNumber()).toBe(100);
  });

  it('จ่ายน้อยกว่า layer แรก → กินบางส่วนของก้อนเดียว', () => {
    const result = allocateFifo([layer('L1', 10, 100)], D(3));

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.qty.toNumber()).toBe(3);
    expect(result.totalCost.toNumber()).toBe(300);
  });

  it('จ่ายหมดทุก layer พอดี → ไม่มี shortage และไม่มีเศษ', () => {
    const result = allocateFifo([layer('L1', 4, 50), layer('L2', 6, 75)], D(10));

    expect(result.shortage.toNumber()).toBe(0);
    expect(result.totalCost.toNumber()).toBe(650); // 4×50 + 6×75
    expect(result.unitCost.toNumber()).toBe(65);
  });

  it('layer ไม่พอ → รายงาน shortage เท่าจำนวนที่ขาด (ผู้เรียกต้อง reject)', () => {
    const result = allocateFifo([layer('L1', 5, 100)], D(8));

    expect(result.shortage.toNumber()).toBe(3);
    expect(result.totalCost.toNumber()).toBe(500);
    // ทุนเฉลี่ยคิดจากจำนวนที่ตัดได้จริง (5 หน่วย) ไม่ใช่ 8
    expect(result.unitCost.toNumber()).toBe(100);
  });

  it('ไม่มี layer เลย → shortage เท่าจำนวนที่ขอ ทุนเป็น 0 (ไม่หารด้วยศูนย์)', () => {
    const result = allocateFifo([], D(5));

    expect(result.lines).toHaveLength(0);
    expect(result.shortage.toNumber()).toBe(5);
    expect(result.totalCost.toNumber()).toBe(0);
    expect(result.unitCost.toNumber()).toBe(0);
  });

  it('ข้าม layer ที่เหลือ 0 (เคยถูกกินหมดแล้ว) ไปกินก้อนถัดไป', () => {
    const result = allocateFifo(
      [layer('L1', 0, 100), layer('L2', 10, 200)],
      D(4),
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.layerId).toBe('L2');
    expect(result.totalCost.toNumber()).toBe(800);
  });

  it('รองรับจำนวนทศนิยม (สายไฟ 12.5 เมตร คร่อม 2 ม้วน)', () => {
    const result = allocateFifo(
      [layer('L1', 10, 9), layer('L2', 10, 8)],
      D('12.5'),
    );

    expect(result.lines[0]!.qty.toNumber()).toBe(10);
    expect(result.lines[1]!.qty.toNumber()).toBe(2.5);
    expect(result.totalCost.toNumber()).toBe(110); // 10×9 + 2.5×8
    expect(result.unitCost.toNumber()).toBe(8.8);
  });

  it('จ่าย 0 → ไม่กิน layer ใดเลย', () => {
    const result = allocateFifo([layer('L1', 10, 100)], D(0));

    expect(result.lines).toHaveLength(0);
    expect(result.totalCost.toNumber()).toBe(0);
    expect(result.shortage.toNumber()).toBe(0);
  });

  it('ทุนเฉลี่ยที่หารไม่ลงตัว ปัดที่ 4 ตำแหน่ง แต่ทุนรวมไม่เพี้ยน', () => {
    const result = allocateFifo(
      [layer('L1', 1, 100), layer('L2', 2, 105)],
      D(3),
    );

    expect(result.totalCost.toNumber()).toBe(310); // 100 + 210
    expect(result.unitCost.toNumber()).toBeCloseTo(103.3333, 4);
  });
});

describe('applyMovingAverage', () => {
  it('รับล็อตแรกจากคลังว่าง → ทุนเฉลี่ยเท่าทุนที่รับ', () => {
    const { newQty, newAvg } = applyMovingAverage(D(0), D(0), D(10), D(1000));

    expect(newQty.toNumber()).toBe(10);
    expect(newAvg.toNumber()).toBe(100);
  });

  it('เคสตามโจทย์: 10@100 แล้วรับอีก 10@200 → avg 150', () => {
    const { newQty, newAvg } = applyMovingAverage(D(10), D(100), D(10), D(2000));

    expect(newQty.toNumber()).toBe(20);
    expect(newAvg.toNumber()).toBe(150);
  });

  it('จ่ายออกที่ทุนเฉลี่ย → avg ไม่เปลี่ยน', () => {
    const { newQty, newAvg } = applyMovingAverage(
      D(20),
      D(150),
      D(-5),
      D(-750),
    );

    expect(newQty.toNumber()).toBe(15);
    expect(newAvg.toNumber()).toBe(150);
  });

  it('จ่ายออกจนหมดคลัง → รีเซ็ต avg เป็น 0 กันเศษค้าง', () => {
    const { newQty, newAvg } = applyMovingAverage(
      D(10),
      D(123.4567),
      D(-10),
      D('-1234.57'),
    );

    expect(newQty.toNumber()).toBe(0);
    expect(newAvg.toNumber()).toBe(0);
  });

  it('กลับรายการการรับเข้า → ถอยมูลค่าออก avg กลับเป็นค่าเดิม', () => {
    // เดิม 10@100 (มูลค่า 1000) รับเพิ่ม 10@200 → 20@150
    const afterReceive = applyMovingAverage(D(10), D(100), D(10), D(2000));
    // กลับรายการล็อตที่สอง
    const afterReverse = applyMovingAverage(
      afterReceive.newQty,
      afterReceive.newAvg,
      D(-10),
      D(-2000),
    );

    expect(afterReverse.newQty.toNumber()).toBe(10);
    expect(afterReverse.newAvg.toNumber()).toBe(100);
  });

  it('ปรับยอดเพิ่มด้วยทุนใหม่ → avg ขยับเข้าหาทุนที่ระบุ', () => {
    const { newQty, newAvg } = applyMovingAverage(D(10), D(100), D(10), D(1400));

    expect(newQty.toNumber()).toBe(20);
    expect(newAvg.toNumber()).toBe(120); // (1000 + 1400) / 20
  });

  it('รองรับจำนวนทศนิยม (สายไฟ)', () => {
    const { newQty, newAvg } = applyMovingAverage(
      D('12.5'),
      D(8),
      D('7.5'),
      D(75),
    );

    expect(newQty.toNumber()).toBe(20);
    expect(newAvg.toNumber()).toBe(8.75); // (100 + 75) / 20
  });
});
