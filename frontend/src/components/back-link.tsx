'use client';

import Link from 'next/link';

/**
 * ลิงก์กลับที่ชี้ปลายทางชัดเจน — ไม่ใช้ router.back() เพราะถ้าผู้ใช้เปิดหน้านี้
 * จากลิงก์ตรง ๆ (หรือเพิ่งรีเฟรช) การถอยจะพาออกนอกเว็บไปเลย
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}
