'use client';

import Link from 'next/link';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { useUrlFilters } from '@/components/list';
import { Card, ErrorState, Loading } from '@/components/ui';
import { dateTh, money, qty } from '@/lib/format';
import type { Product, Warehouse } from '@/lib/types';

interface CardEntry {
  id: string;
  createdAt: string;
  movementType: string;
  refDocType: string;
  refDocId: string;
  qty: string;
  unitCost: string;
  totalCost: string;
  balance: string;
  note: string | null;
}

interface StockCard {
  openingQty: string;
  closingQty: string;
  entries: CardEntry[];
}

interface Lot {
  id: string;
  lotNo: string;
  expiryDate: string | null;
  remainingQty: string;
  daysToExpiry: number | null;
  isExpired: boolean;
}

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIVE: 'รับเข้า',
  ISSUE: 'จ่ายออก',
  ADJUST_IN: 'ปรับเพิ่ม',
  ADJUST_OUT: 'ปรับลด',
  TRANSFER_IN: 'โอนเข้า',
  TRANSFER_OUT: 'โอนออก',
  REVERSAL: 'กลับรายการ',
};

const DOC_LABEL: Record<string, string> = {
  GR: 'ใบรับของ',
  DO: 'ใบส่งของ',
  MANUAL: 'บันทึกมือ',
  ADJUSTMENT: 'ปรับยอด',
};

function StockCardPage({ productId }: { productId: string }) {
  const { params, setFilter } = useUrlFilters();
  const warehouseId = params.get('warehouseId') ?? '';

  const [product, setProduct] = useState<Product | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [card, setCard] = useState<StockCard | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [error, setError] = useState<string | null>(null);

  // เลือกคลังแรกให้อัตโนมัติถ้ายังไม่ได้เลือก — ผู้ใช้ไม่ต้องกดเองก่อนเห็นข้อมูล
  useEffect(() => {
    void api<Warehouse[]>('warehouses')
      .then((list) => {
        setWarehouses(list);
        if (!warehouseId && list[0]) setFilter({ warehouseId: list[0].id });
      })
      .catch(() => setWarehouses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!warehouseId) return;
    setError(null);
    setCard(null);

    void Promise.all([
      api<Product>(`products/${productId}`),
      api<StockCard>(
        `inventory/stock-card?productId=${productId}&warehouseId=${warehouseId}`,
      ),
    ])
      .then(async ([p, c]) => {
        setProduct(p);
        setCard(c);
        if (p.trackingType === 'LOT') {
          setLots(
            await api<Lot[]>(
              `inventory/lots?productId=${productId}&warehouseId=${warehouseId}`,
            ).catch(() => []),
          );
        }
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'),
      );
  }, [productId, warehouseId]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/stock" label="กลับไปยอดคงเหลือ" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {product ? (
            <>
              <h1 className="text-xl font-bold">{product.name}</h1>
              <p className="text-sm text-slate-500">
                {product.sku} · หน่วย {product.baseUom?.name}
              </p>
            </>
          ) : (
            <div className="space-y-2">
              <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
            </div>
          )}
        </div>

        {warehouses.length > 1 && (
          <select
            value={warehouseId}
            onChange={(e) => setFilter({ warehouseId: e.target.value })}
            aria-label="เลือกคลัง"
            className="tap-target rounded-lg border border-slate-300 bg-white px-3"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {product && (
        <Link
          href={`/products/${productId}`}
          className="inline-block text-sm text-sky-700 hover:underline"
        >
          ดูข้อมูลสินค้า →
        </Link>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!card && !error && <Loading label="กำลังโหลดความเคลื่อนไหว…" />}

      {card && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Card className="text-center">
              <p className="text-xs text-slate-500">ยกมา</p>
              <p className="text-lg font-bold">{qty(card.openingQty)}</p>
            </Card>
            <Card className="text-center">
              <p className="text-xs text-slate-500">เคลื่อนไหว</p>
              <p className="text-lg font-bold">{card.entries.length} ครั้ง</p>
            </Card>
            <Card className="bg-slate-900 text-center text-white">
              <p className="text-xs text-slate-300">คงเหลือ</p>
              <p className="text-lg font-bold">{qty(card.closingQty)}</p>
            </Card>
          </div>

          {product?.trackingType === 'LOT' && lots.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium">
                ล็อตคงเหลือ (เรียงตามที่ควรจ่ายก่อน)
              </h2>
              <ul className="divide-y divide-slate-100">
                {lots.map((lot) => (
                  <li
                    key={lot.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{lot.lotNo}</p>
                      <p
                        className={
                          lot.isExpired
                            ? 'text-red-600'
                            : lot.daysToExpiry !== null && lot.daysToExpiry <= 30
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }
                      >
                        {lot.expiryDate
                          ? lot.isExpired
                            ? `หมดอายุแล้ว (${dateTh(lot.expiryDate)})`
                            : `หมดอายุ ${dateTh(lot.expiryDate)} · อีก ${lot.daysToExpiry} วัน`
                          : 'ไม่ระบุวันหมดอายุ'}
                      </p>
                    </div>
                    <span className="font-medium">{qty(lot.remainingQty)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 font-medium">ความเคลื่อนไหว (Stock Card)</h2>

            {card.entries.length === 0 ? (
              <p className="py-6 text-center text-slate-500">
                ยังไม่มีการรับเข้า/จ่ายออกในคลังนี้
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...card.entries].reverse().map((e) => {
                  const isIn = Number(e.qty) > 0;
                  return (
                    <li key={e.id} className="flex items-start gap-3 py-3">
                      <span
                        aria-hidden
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-sm ${
                          isIn
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {isIn ? '↓' : '↑'}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {MOVEMENT_LABEL[e.movementType] ?? e.movementType}
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {DOC_LABEL[e.refDocType] ?? e.refDocType} {e.refDocId}
                        </p>
                        <p className="text-xs text-slate-400">
                          {dateTh(e.createdAt)} · ทุน ฿{money(e.unitCost)}/หน่วย
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p
                          className={`font-medium ${isIn ? 'text-emerald-700' : 'text-red-700'}`}
                        >
                          {isIn ? '+' : ''}
                          {qty(e.qty)}
                        </p>
                        <p className="text-xs text-slate-500">
                          เหลือ {qty(e.balance)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function Page({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = use(params);
  return (
    <Suspense>
      <StockCardPage productId={productId} />
    </Suspense>
  );
}
