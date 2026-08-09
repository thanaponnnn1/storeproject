'use client';

import Link from 'next/link';
import { useUser } from '@/components/user-context';

const SHORTCUTS = [
  {
    href: '/receive',
    icon: '📥',
    label: 'รับของเข้าคลัง',
    hint: 'ยิงบาร์โค้ดรับของ',
  },
  {
    href: '/issue',
    icon: '📤',
    label: 'จ่ายของออก',
    hint: 'ยิงบาร์โค้ดจ่ายของ',
  },
  {
    href: '/scan',
    icon: '📷',
    label: 'สแกนเช็คของ',
    hint: 'ดูยอด/เช็คประกัน',
  },
  { href: '/stock', icon: '📦', label: 'ยอดคงเหลือ', hint: 'ดูของในคลัง' },
  { href: '/products', icon: '🏷️', label: 'สินค้า', hint: 'ค้นหา/แก้ไขสินค้า' },
  { href: '/sales', icon: '🧾', label: 'งานขาย', hint: 'ใบเสนอราคา → เก็บเงิน' },
];

export default function HomePage() {
  const user = useUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">สวัสดี {user.name}</h1>
        <p className="text-sm text-slate-500">เลือกเมนูที่ต้องการใช้งาน</p>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SHORTCUTS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex h-32 flex-col justify-center gap-1 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400 active:scale-[0.98]"
            >
              <span aria-hidden className="text-3xl">
                {s.icon}
              </span>
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-slate-500">{s.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
