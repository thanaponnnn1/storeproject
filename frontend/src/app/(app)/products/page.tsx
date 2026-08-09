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
import { TRACKING_LABEL, money } from '@/lib/format';
import type { Product } from '@/lib/types';

const TRACKING_BADGE: Record<string, string> = {
  SERIAL: 'bg-violet-100 text-violet-800',
  LOT: 'bg-amber-100 text-amber-800',
  NONE: 'bg-slate-100 text-slate-700',
};

function ProductList() {
  const { params } = useUrlFilters();
  const canEdit = useCan(['ADMIN', 'MANAGER']);

  const query = new URLSearchParams({
    page: params.get('page') ?? '1',
    limit: '20',
    ...(params.get('search') ? { search: params.get('search')! } : {}),
    ...(params.get('trackingType')
      ? { trackingType: params.get('trackingType')! }
      : {}),
  }).toString();

  const { items, meta, loading, error, reload } = useList<Product>(
    'products',
    query,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">สินค้า</h1>
        {canEdit && (
          <Link href="/products/new">
            <Button>+ เพิ่มสินค้า</Button>
          </Link>
        )}
      </div>

      <SearchInput placeholder="ค้นหา รหัส / ชื่อ / ยี่ห้อ / บาร์โค้ด" scannable />

      <FilterTabs
        name="trackingType"
        options={[
          { value: '', label: 'ทั้งหมด' },
          { value: 'SERIAL', label: 'ตามเครื่อง' },
          { value: 'LOT', label: 'ตามล็อต' },
          { value: 'NONE', label: 'นับจำนวน' },
        ]}
      />

      <ListState
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        emptyLabel={
          params.get('search')
            ? `ไม่พบสินค้าที่ตรงกับ "${params.get('search')}"`
            : 'ยังไม่มีสินค้าในระบบ'
        }
        onRetry={reload}
      >
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/products/${p.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-400 active:scale-[0.99]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${TRACKING_BADGE[p.trackingType]}`}
                    >
                      {TRACKING_LABEL[p.trackingType]}
                    </span>
                    {!p.isActive && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                        ปิดใช้งาน
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-slate-500">
                    {p.sku}
                    {p.brand ? ` · ${p.brand}` : ''}
                    {p.baseUom ? ` · หน่วย ${p.baseUom.name}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">฿{money(p.priceRetail)}</p>
                  <p className="text-xs text-slate-500">ราคาปลีก</p>
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

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductList />
    </Suspense>
  );
}
