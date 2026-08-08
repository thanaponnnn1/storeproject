export const TRACKING_LABEL: Record<string, string> = {
  NONE: 'นับจำนวน',
  SERIAL: 'ตามเครื่อง (serial)',
  LOT: 'ตามล็อต (วันหมดอายุ)',
};

export const COSTING_LABEL: Record<string, string> = {
  AVG: 'ทุนเฉลี่ย',
  FIFO: 'FIFO (เข้าก่อนออกก่อน)',
};

export const PARTNER_TYPE_LABEL: Record<string, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ซัพพลายเออร์',
  BOTH: 'ลูกค้า+ซัพพลายเออร์',
};

export const PRICE_LEVEL_LABEL: Record<string, string> = {
  RETAIL: 'ราคาปลีก',
  CONTRACTOR: 'ราคาช่าง',
  PROJECT: 'ราคาโครงการ',
};

/** เงิน — ใส่คอมมาและทศนิยม 2 ตำแหน่งเสมอ อ่านง่ายและไม่กำกวม */
export function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** จำนวนสินค้า — ตัดศูนย์ท้ายทิ้ง (12.500 → 12.5, 10.000 → 10) */
export function qty(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
}

export function dateTh(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
