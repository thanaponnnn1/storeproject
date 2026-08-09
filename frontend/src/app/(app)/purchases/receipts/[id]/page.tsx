'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { DocAction } from '@/components/doc';
import { DocHeader } from '@/components/doc-detail';
import { Card, ErrorState, Loading } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { money, qty as fmtQty } from '@/lib/format';

interface GoodsReceipt {
  id: string;
  docNo: string;
  status: string;
  docDate: string;
  supplierRef: string | null;
  partner: { code: string; name: string };
  warehouse: { code: string; name: string };
  purchaseOrder: { id: string; docNo: string };
  lines: {
    id: string;
    qty: string;
    baseQty: string;
    unitCost: string;
    lineTotal: string;
    serials: string[];
    lotNo: string | null;
    product: { sku: string; name: string };
    productUnit: { uom: { name: string } } | null;
  }[];
}

export default function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const canWork = useCan(['ADMIN', 'MANAGER', 'WAREHOUSE']);
  const canCancel = useCan(['ADMIN', 'MANAGER']);

  const [gr, setGr] = useState<GoodsReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<GoodsReceipt>(`goods-receipts/${id}`)
      .then(setGr)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดเอกสารไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/purchases?tab=receipts" label="กลับไปใบรับของ" />

      {error && <ErrorState message={error} onRetry={load} />}
      {!gr && !error && <Loading />}

      {gr && (
        <>
          <DocHeader
            docNo={gr.docNo}
            status={gr.status}
            partnerName={gr.partner.name}
            docDate={gr.docDate}
            extra={
              <p className="text-sm text-slate-500">
                เข้า {gr.warehouse.name} · ตาม{' '}
                <Link
                  href={`/purchases/orders/${gr.purchaseOrder.id}`}
                  className="text-sky-700 hover:underline"
                >
                  {gr.purchaseOrder.docNo}
                </Link>
                {gr.supplierRef ? ` · ใบส่งของผู้ขาย ${gr.supplierRef}` : ''}
              </p>
            }
          />

          <div className="flex flex-wrap gap-2">
            {gr.status === 'DRAFT' && canWork && (
              <DocAction
                label="ยืนยันรับของ (เข้าสต๊อกจริง)"
                onDone={load}
                action={() =>
                  api(`goods-receipts/${id}/confirm`, { method: 'PATCH' })
                }
              />
            )}
            {gr.status !== 'CANCELLED' && canCancel && (
              <DocAction
                label="ยกเลิกใบรับของ"
                variant="danger"
                confirm={
                  gr.status === 'CONFIRMED'
                    ? 'ยกเลิกใบรับของที่ยืนยันแล้วใช่ไหม?\n\nระบบจะกลับรายการในบัญชีสต๊อก (ของที่รับเข้าจะถูกหักออก) ถ้าของถูกขายไปแล้วจะยกเลิกไม่ได้'
                    : 'ยกเลิกใบรับของนี้ใช่ไหม?'
                }
                onDone={load}
                action={() =>
                  api(`goods-receipts/${id}/cancel`, { method: 'PATCH' })
                }
              />
            )}
          </div>

          <Card>
            <h2 className="mb-2 font-medium">รายการที่รับ</h2>
            <ul className="divide-y divide-slate-100">
              {gr.lines.map((l) => (
                <li key={l.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{l.product.name}</p>
                      <p className="truncate text-sm text-slate-500">
                        {l.product.sku} · {fmtQty(l.qty)}{' '}
                        {l.productUnit?.uom.name ?? ''} × ฿{money(l.unitCost)}
                      </p>
                      {l.lotNo && (
                        <p className="text-sm text-amber-700">
                          ล็อต {l.lotNo}
                        </p>
                      )}
                      {l.serials.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">
                          serial: {l.serials.join(', ')}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-medium">
                      ฿{money(l.lineTotal)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
