'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import {
  FilterTabs,
  ListState,
  Pagination,
  SearchInput,
  useList,
  useUrlFilters,
} from '@/components/list';
import { WarehouseSelect } from '@/components/warehouse-select';
import { ApiError, api } from '@/lib/api';
import { money, qty } from '@/lib/format';

interface Balance {
  productId: string;
  warehouseId: string;
  qtyOnHand: string;
  avgCost: string;
  value: string;
  belowMin: boolean;
  product: {
    sku: string;
    name: string;
    minStock: string;
    trackingType: string;
    baseUom: { code: string; name: string };
  };
  warehouse: { code: string; name: string };
}

interface LowStockItem {
  productId: string;
  sku: string;
  name: string;
  uom: string;
  qtyOnHand: string;
  minStock: string;
  shortBy: string;
  warehouse: { code: string; name: string };
}

function StockRow({
  href,
  title,
  subtitle,
  right,
  rightHint,
  warning,
}: {
  href: string;
  title: string;
  subtitle: string;
  right: string;
  rightHint: string;
  warning?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl border bg-white p-3 transition hover:border-slate-400 active:scale-[0.99] ${
        warning ? 'border-amber-300' : 'border-slate-200'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="truncate text-sm text-slate-500">{subtitle}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`font-medium ${warning ? 'text-amber-700' : ''}`}>
          {right}
        </p>
        <p className="text-xs text-slate-500">{rightHint}</p>
      </div>
      <span aria-hidden className="shrink-0 text-slate-400">
        ›
      </span>
    </Link>
  );
}

/** แท็บ "ต่ำกว่าจุดสั่งซื้อ" ใช้รายงานคนละตัว จึงแยก component */
function LowStockList({ warehouseId }: { warehouseId: string }) {
  const [items, setItems] = useState<LowStockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    api<LowStockItem[]>(
      `reports/low-stock${warehouseId ? `?warehouseId=${warehouseId}` : ''}`,
    )
      .then(setItems)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'),
      );
  }, [warehouseId]);

  useEffect(load, [load]);

  return (
    <ListState
      loading={items === null && !error}
      error={error}
      isEmpty={items?.length === 0}
      emptyLabel="ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ — สต๊อกยังพอทุกตัว 👍"
      onRetry={load}
    >
      <ul className="space-y-2">
        {items?.map((i) => (
          <li key={`${i.productId}-${i.warehouse.code}`}>
            <StockRow
              href={`/stock/${i.productId}`}
              title={i.name}
              subtitle={`${i.sku} · ต้องมีอย่างน้อย ${qty(i.minStock)} ${i.uom}`}
              right={`${qty(i.qtyOnHand)} ${i.uom}`}
              rightHint={`ขาดอีก ${qty(i.shortBy)}`}
              warning
            />
          </li>
        ))}
      </ul>
    </ListState>
  );
}

function AllStockList({ query }: { query: string }) {
  const { params } = useUrlFilters();
  const { items, meta, loading, error, reload } = useList<Balance>(
    'inventory/balances',
    query,
  );

  return (
    <ListState
      loading={loading}
      error={error}
      isEmpty={items.length === 0}
      emptyLabel={
        params.get('search')
          ? `ไม่พบสินค้าที่ตรงกับ "${params.get('search')}"`
          : 'ยังไม่มีความเคลื่อนไหวของสต๊อก'
      }
      onRetry={reload}
    >
      <ul className="space-y-2">
        {items.map((b) => (
          <li key={`${b.productId}-${b.warehouseId}`}>
            <StockRow
              href={`/stock/${b.productId}?warehouseId=${b.warehouseId}`}
              title={b.product.name}
              subtitle={`${b.product.sku} · ${b.warehouse.name}`}
              right={`${qty(b.qtyOnHand)} ${b.product.baseUom.code}`}
              rightHint={`ทุน ฿${money(b.avgCost)} · มูลค่า ฿${money(b.value)}`}
              warning={b.belowMin}
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
  );
}

function StockPage() {
  const { params } = useUrlFilters();
  const view = params.get('view') ?? '';
  const warehouseId = params.get('warehouseId') ?? '';

  const query = new URLSearchParams({
    page: params.get('page') ?? '1',
    limit: '20',
    hideZero: 'true',
    ...(params.get('search') ? { search: params.get('search')! } : {}),
    ...(warehouseId ? { warehouseId } : {}),
  }).toString();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">ยอดคงเหลือ</h1>

      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput placeholder="ค้นหา รหัส / ชื่อสินค้า" />
        </div>
        <WarehouseSelect />
      </div>

      <FilterTabs
        name="view"
        options={[
          { value: '', label: 'ทั้งหมด' },
          { value: 'low', label: '⚠️ ต่ำกว่าจุดสั่งซื้อ' },
        ]}
      />

      {view === 'low' ? (
        <LowStockList warehouseId={warehouseId} />
      ) : (
        <AllStockList query={query} />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <StockPage />
    </Suspense>
  );
}
