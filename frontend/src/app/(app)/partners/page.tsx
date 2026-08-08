'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import {
  FilterTabs,
  ListState,
  Pagination,
  SearchInput,
  useList,
  useUrlFilters,
} from '@/components/list';
import { Button } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { PARTNER_TYPE_LABEL, PRICE_LEVEL_LABEL } from '@/lib/format';
import type { Partner } from '@/lib/types';

const TYPE_BADGE: Record<string, string> = {
  CUSTOMER: 'bg-sky-100 text-sky-800',
  SUPPLIER: 'bg-emerald-100 text-emerald-800',
  BOTH: 'bg-indigo-100 text-indigo-800',
};

function PartnerList() {
  const { params } = useUrlFilters();
  const canAdd = useCan(['ADMIN', 'MANAGER', 'SALES']);

  const query = new URLSearchParams({
    page: params.get('page') ?? '1',
    limit: '20',
    ...(params.get('search') ? { search: params.get('search')! } : {}),
    ...(params.get('type') ? { type: params.get('type')! } : {}),
  }).toString();

  const { items, meta, loading, error, reload } = useList<Partner>(
    'partners',
    query,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">ลูกค้า / ซัพพลายเออร์</h1>
        {canAdd && (
          <Link href="/partners/new">
            <Button>+ เพิ่ม</Button>
          </Link>
        )}
      </div>

      <SearchInput placeholder="ค้นหา รหัส / ชื่อ / เบอร์โทร" />

      <FilterTabs
        name="type"
        options={[
          { value: '', label: 'ทั้งหมด' },
          { value: 'CUSTOMER', label: 'ลูกค้า' },
          { value: 'SUPPLIER', label: 'ซัพพลายเออร์' },
          { value: 'BOTH', label: 'ทั้งสองอย่าง' },
        ]}
      />

      <ListState
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        emptyLabel={
          params.get('search')
            ? `ไม่พบคู่ค้าที่ตรงกับ "${params.get('search')}"`
            : 'ยังไม่มีคู่ค้าในระบบ'
        }
        onRetry={reload}
      >
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/partners/${p.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-400 active:scale-[0.99]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${TYPE_BADGE[p.type]}`}
                    >
                      {PARTNER_TYPE_LABEL[p.type]}
                    </span>
                    {!p.isActive && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                        ปิดใช้งาน
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-slate-500">
                    {p.code}
                    {p.phone ? ` · ${p.phone}` : ''}
                    {p.type !== 'SUPPLIER'
                      ? ` · ${PRICE_LEVEL_LABEL[p.priceLevel]}`
                      : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm text-slate-500">
                  {p.creditTermDays > 0
                    ? `เครดิต ${p.creditTermDays} วัน`
                    : 'เงินสด'}
                </div>
                <span aria-hidden className="shrink-0 text-slate-400">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {meta && (
          <div className="pt-2">
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              total={meta.total}
            />
          </div>
        )}
      </ListState>
    </div>
  );
}

export default function PartnersPage() {
  return (
    <Suspense>
      <PartnerList />
    </Suspense>
  );
}
