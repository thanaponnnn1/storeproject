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
import { DocRow } from '@/components/doc';
import { Alert, Button } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { dateTh } from '@/lib/format';

interface PurchaseDoc {
  id: string;
  docNo: string;
  status: string;
  docDate: string;
  totalAmount?: string;
  partner: { code: string; name: string };
  purchaseOrder?: { docNo: string };
}

const TABS = [
  { value: '', label: 'ใบสั่งซื้อ', path: 'purchase-orders', href: '/purchases/orders' },
  { value: 'receipts', label: 'ใบรับของ', path: 'goods-receipts', href: '/purchases/receipts' },
];

function PurchaseHub() {
  const { params } = useUrlFilters();
  const tab = params.get('tab') ?? '';
  const current = TABS.find((t) => t.value === tab) ?? TABS[0];
  const canCreate = useCan(['ADMIN', 'MANAGER', 'WAREHOUSE']);
  const done = params.get('done');

  const query = new URLSearchParams({
    page: params.get('page') ?? '1',
    limit: '20',
    ...(params.get('search') ? { search: params.get('search')! } : {}),
  }).toString();

  const { items, meta, loading, error, reload } = useList<PurchaseDoc>(
    current.path,
    query,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">งานซื้อ</h1>
        {canCreate && tab === '' && (
          <Link href="/purchases/orders/new">
            <Button>+ ใบสั่งซื้อ</Button>
          </Link>
        )}
      </div>

      {done && (
        <Alert tone="info">
          รับของเรียบร้อย — ใบรับของ <strong>{done}</strong>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
        <p className="whitespace-nowrap text-sm text-slate-600">
          ใบสั่งซื้อ → อนุมัติ → รับของเข้าคลัง (ยิงบาร์โค้ด)
        </p>
      </div>

      <FilterTabs name="tab" options={TABS} />
      <SearchInput placeholder="ค้นหาเลขที่เอกสาร" />

      <ListState
        loading={loading}
        error={error}
        isEmpty={items.length === 0}
        emptyLabel={
          params.get('search')
            ? `ไม่พบเอกสารเลขที่ตรงกับ "${params.get('search')}"`
            : `ยังไม่มี${current.label}`
        }
        onRetry={reload}
      >
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.id}>
              <DocRow
                href={`${current.href}/${d.id}`}
                docNo={d.docNo}
                status={d.status}
                partnerName={d.partner.name}
                date={dateTh(d.docDate)}
                amount={d.totalAmount}
                hint={d.purchaseOrder ? `ตาม ${d.purchaseOrder.docNo}` : undefined}
              />
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

export default function Page() {
  return (
    <Suspense>
      <PurchaseHub />
    </Suspense>
  );
}
