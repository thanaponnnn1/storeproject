'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** role ที่เห็นเมนูนี้ — ไม่ระบุ = ทุกคนที่ login เห็น */
  roles?: string[];
}

/** เมนูหลัก 5 อันบนมือถือ (มากกว่านี้กดยาก) ที่เหลืออยู่ใน "เพิ่มเติม" */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/', label: 'หน้าหลัก', icon: '🏠' },
  { href: '/scan', label: 'สแกน', icon: '📷' },
  { href: '/stock', label: 'สต๊อก', icon: '📦' },
  { href: '/products', label: 'สินค้า', icon: '🏷️' },
  { href: '/more', label: 'เพิ่มเติม', icon: '☰' },
];

export const ALL_NAV: NavItem[] = [
  { href: '/partners', label: 'ลูกค้า/ซัพพลายเออร์', icon: '🤝' },
  { href: '/sales', label: 'งานขาย', icon: '🧾' },
  { href: '/purchases', label: 'งานซื้อ', icon: '🚚' },
  { href: '/reports', label: 'รายงาน', icon: '📊', roles: ['ADMIN', 'MANAGER'] },
  { href: '/audit', label: 'ประวัติการใช้งาน', icon: '🕘', roles: ['ADMIN', 'MANAGER'] },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** แถบเมนูล่างสำหรับมือถือ — นิ้วโป้งเอื้อมถึง */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs ${
                  active ? 'font-semibold text-slate-900' : 'text-slate-500'
                }`}
              >
                <span aria-hidden className="text-xl">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** เมนูข้างสำหรับจอใหญ่ */
export function SideNav({ role }: { role: string }) {
  const pathname = usePathname();
  const items = [
    ...PRIMARY_NAV.filter((i) => i.href !== '/more'),
    ...ALL_NAV,
  ].filter((i) => !i.roles || i.roles.includes(role));

  return (
    <nav className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-3 lg:block">
      <ul className="space-y-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${
                  active
                    ? 'bg-slate-900 font-medium text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    // replace ไม่ push — กดถอยแล้วต้องไม่ย้อนกลับเข้าหน้าที่ต้อง login
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {loading ? 'กำลังออก…' : 'ออกจากระบบ'}
    </button>
  );
}
