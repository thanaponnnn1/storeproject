import { UnprocessableEntityException } from '@nestjs/common';

/**
 * ตารางกลางของ state machine — การเปลี่ยนสถานะที่ไม่อยู่ในตารางนี้ทำไม่ได้
 * ทุกอย่างประกาศไว้ที่เดียวเพื่อให้อ่านเห็นเส้นทางเอกสารทั้งระบบในหน้าเดียว
 */
export const ALLOWED_TRANSITIONS = {
  QT: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['APPROVED', 'DRAFT', 'CANCELLED'],
    APPROVED: ['CONVERTED', 'EXPIRED', 'CANCELLED'],
    CONVERTED: [],
    EXPIRED: [],
    CANCELLED: [],
  },
  SO: {
    DRAFT: ['CONFIRMED', 'CANCELLED'],
    // ยกเลิกได้ก่อนส่งของเท่านั้น
    CONFIRMED: ['PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED'],
    PARTIALLY_DELIVERED: ['DELIVERED', 'CONFIRMED', 'CLOSED'],
    DELIVERED: ['CLOSED', 'PARTIALLY_DELIVERED'],
    CLOSED: [],
    CANCELLED: [],
  },
  DO: {
    DRAFT: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['CANCELLED'], // ยกเลิกหลัง confirm = สร้าง reversal ใน ledger
    CANCELLED: [],
  },
  INV: {
    DRAFT: ['ISSUED', 'VOID'],
    ISSUED: ['PARTIALLY_PAID', 'PAID', 'VOID'],
    PARTIALLY_PAID: ['PAID', 'ISSUED'],
    PAID: ['PARTIALLY_PAID'], // ถอยกลับได้เมื่อยกเลิกการรับชำระ
    VOID: [],
  },
  PO: {
    DRAFT: ['APPROVED', 'CANCELLED'],
    // ยกเลิกได้ก่อนของเข้าเท่านั้น
    APPROVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
    PARTIALLY_RECEIVED: ['RECEIVED', 'APPROVED', 'CLOSED'],
    RECEIVED: ['CLOSED', 'PARTIALLY_RECEIVED'],
    CLOSED: [],
    CANCELLED: [],
  },
  GR: {
    DRAFT: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['CANCELLED'], // ยกเลิกหลัง confirm = สร้าง reversal ใน ledger
    CANCELLED: [],
  },
} as const;

type TransitionMap = typeof ALLOWED_TRANSITIONS;
export type DocKind = keyof TransitionMap;

export function assertTransition(
  kind: DocKind,
  from: string,
  to: string,
): void {
  const allowed = (ALLOWED_TRANSITIONS[kind] as Record<string, readonly string[]>)[from];
  if (!allowed) {
    throw new UnprocessableEntityException(
      `สถานะ ${from} ไม่ถูกต้องสำหรับเอกสาร ${kind}`,
    );
  }
  if (!allowed.includes(to)) {
    throw new UnprocessableEntityException(
      `เปลี่ยนสถานะ ${kind} จาก ${from} → ${to} ไม่ได้` +
        (allowed.length
          ? ` (จาก ${from} ไปได้เฉพาะ: ${allowed.join(', ')})`
          : ` (${from} เป็นสถานะสุดท้าย)`),
    );
  }
}

/** เอกสารแก้ไขได้เฉพาะตอนเป็นฉบับร่างเท่านั้น */
export function assertEditable(kind: DocKind, status: string): void {
  if (status !== 'DRAFT') {
    throw new UnprocessableEntityException(
      `แก้ไขเอกสาร ${kind} ไม่ได้ — สถานะปัจจุบันคือ ${status} (แก้ได้เฉพาะฉบับร่าง)`,
    );
  }
}
