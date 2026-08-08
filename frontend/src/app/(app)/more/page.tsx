'use client';

import Link from 'next/link';
import { ALL_NAV } from '@/components/nav';
import { useUser } from '@/components/user-context';

export default function MorePage() {
  const user = useUser();
  const items = ALL_NAV.filter((i) => !i.roles || i.roles.includes(user.role));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">เมนูเพิ่มเติม</h1>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-3 px-4 py-4 hover:bg-slate-50"
            >
              <span aria-hidden className="text-xl">
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              <span aria-hidden className="text-slate-400">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
