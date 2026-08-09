'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { DocAction, StatusBadge } from '@/components/doc';
import {
  DocHeader,
  DocLines,
  DocSummary,
  type DocLineView,
} from '@/components/doc-detail';
import { Alert, Button, Card, ErrorState, Loading } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { dateTh } from '@/lib/format';

interface PurchaseOrder {
  id: string;
  docNo: string;
  status: string;
  docDate: string;
  expectedDate: string | null;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  partner: { code: string; name: string };
  warehouse: { code: string; name: string };
  lines: DocLineView[];
  receipts: { id: string; docNo: string; status: string; docDate: string }[];
}

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const canApprove = useCan(['ADMIN', 'MANAGER']);
  const canWork = useCan(['ADMIN', 'MANAGER', 'WAREHOUSE']);

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<PurchaseOrder>(`purchase-orders/${id}`)
      .then(setPo)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดเอกสารไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/purchases" label="กลับไปงานซื้อ" />

      {error && <ErrorState message={error} onRetry={load} />}
      {!po && !error && <Loading />}

      {po && (
        <>
          <DocHeader
            docNo={po.docNo}
            status={po.status}
            partnerName={po.partner.name}
            docDate={po.docDate}
            extra={
              <p className="text-sm text-slate-500">
                รับเข้า {po.warehouse.name}
                {po.expectedDate
                  ? ` · กำหนดรับ ${dateTh(po.expectedDate)}`
                  : ''}
              </p>
            }
          />

          <div className="flex flex-wrap gap-2">
            {po.status === 'DRAFT' && canApprove && (
              <DocAction
                label="อนุมัติใบสั่งซื้อ"
                confirm="อนุมัติใบสั่งซื้อนี้ใช่ไหม?&#10;&#10;อนุมัติแล้วจะรับของเข้าคลังได้ และแก้ไขใบสั่งซื้อไม่ได้อีก"
                onDone={load}
                action={() =>
                  api(`purchase-orders/${id}/approve`, { method: 'PATCH' })
                }
              />
            )}

            {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) &&
              canWork && (
                <Link href="/receive" className="flex-1">
                  <Button className="w-full">📥 ไปรับของ</Button>
                </Link>
              )}

            {po.status === 'DRAFT' && canApprove && (
              <DocAction
                label="ยกเลิก"
                variant="danger"
                confirm="ยกเลิกใบสั่งซื้อนี้ใช่ไหม?"
                onDone={load}
                action={() =>
                  api(`purchase-orders/${id}/cancel`, { method: 'PATCH' })
                }
              />
            )}
          </div>

          {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
            <Alert tone="info">
              รับของโดยไปที่เมนู <strong>รับของเข้าคลัง</strong> แล้วเลือกใบสั่งซื้อ{' '}
              {po.docNo} จากนั้นยิงบาร์โค้ดสินค้า
            </Alert>
          )}

          <DocLines lines={po.lines} showProgress="received" />
          <DocSummary
            subtotal={po.subtotal}
            vatAmount={po.vatAmount}
            totalAmount={po.totalAmount}
          />

          {po.receipts.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium">ใบรับของ</h2>
              <ul className="divide-y divide-slate-100">
                {po.receipts.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link
                      href={`/purchases/receipts/${r.id}`}
                      className="flex items-center justify-between gap-2 text-sm hover:underline"
                    >
                      <span className="text-sky-700">
                        {r.docNo}
                        <span className="text-slate-500">
                          {' · '}
                          {dateTh(r.docDate)}
                        </span>
                      </span>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
