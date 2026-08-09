'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

interface SalesOrder {
  id: string;
  docNo: string;
  status: string;
  docDate: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  partner: { code: string; name: string };
  warehouse: { code: string; name: string };
  quotation: { id: string; docNo: string } | null;
  lines: DocLineView[];
  deliveries: { id: string; docNo: string; status: string; docDate: string }[];
  invoices: { id: string; docNo: string; status: string; totalAmount: string }[];
}

export default function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const canWork = useCan(['ADMIN', 'MANAGER', 'SALES']);

  const [so, setSo] = useState<SalesOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<SalesOrder>(`sales-orders/${id}`)
      .then(setSo)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดเอกสารไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  // ใบส่งของที่ยืนยันแล้วเท่านั้นที่วางบิลได้
  // (ถ้าเคยวางบิลไปแล้ว backend จะปฏิเสธพร้อมบอกเลขใบ — ปุ่มจะโชว์ข้อความนั้นให้)
  const billable = so?.deliveries.filter((d) => d.status === 'CONFIRMED') ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/sales?tab=orders" label="กลับไปใบสั่งขาย" />

      {error && <ErrorState message={error} onRetry={load} />}
      {!so && !error && <Loading />}

      {so && (
        <>
          <DocHeader
            docNo={so.docNo}
            status={so.status}
            partnerName={so.partner.name}
            docDate={so.docDate}
            extra={
              <p className="text-sm text-slate-500">
                จ่ายจาก {so.warehouse.name}
                {so.quotation && (
                  <>
                    {' · มาจาก '}
                    <Link
                      href={`/sales/quotations/${so.quotation.id}`}
                      className="text-sky-700 hover:underline"
                    >
                      {so.quotation.docNo}
                    </Link>
                  </>
                )}
              </p>
            }
          />

          {canWork && (
            <div className="flex flex-wrap gap-2">
              {so.status === 'DRAFT' && (
                <DocAction
                  label="ยืนยันใบสั่งขาย"
                  confirm="ยืนยันใบสั่งขายนี้ใช่ไหม?&#10;&#10;ยืนยันแล้วจะเริ่มจ่ายของได้ และแก้ไขใบสั่งขายไม่ได้อีก"
                  onDone={load}
                  action={() =>
                    api(`sales-orders/${id}/confirm`, { method: 'PATCH' })
                  }
                />
              )}

              {['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(so.status) && (
                <Link href="/issue" className="flex-1">
                  <Button className="w-full">📤 ไปจ่ายของ</Button>
                </Link>
              )}

              {billable.length > 0 && (
                <DocAction
                  label="วางบิล (ออกใบแจ้งหนี้)"
                  onDone={() => router.refresh()}
                  action={async () => {
                    const inv = await api<{ id: string }>('invoices', {
                      method: 'POST',
                      body: { deliveryOrderIds: billable.map((d) => d.id) },
                    });
                    router.push(`/sales/invoices/${inv.id}`);
                  }}
                />
              )}

              {so.status === 'DRAFT' && (
                <DocAction
                  label="ยกเลิก"
                  variant="danger"
                  confirm="ยกเลิกใบสั่งขายนี้ใช่ไหม?"
                  onDone={load}
                  action={() =>
                    api(`sales-orders/${id}/cancel`, { method: 'PATCH' })
                  }
                />
              )}
            </div>
          )}

          {['CONFIRMED', 'PARTIALLY_DELIVERED'].includes(so.status) && (
            <Alert tone="info">
              จ่ายของโดยไปที่เมนู <strong>จ่ายของออก</strong> แล้วเลือกใบสั่งขาย{' '}
              {so.docNo} จากนั้นยิงบาร์โค้ดสินค้า
            </Alert>
          )}

          <DocLines lines={so.lines} showProgress="delivered" />
          <DocSummary
            subtotal={so.subtotal}
            vatAmount={so.vatAmount}
            totalAmount={so.totalAmount}
          />

          {so.deliveries.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium">ใบส่งของ</h2>
              <ul className="divide-y divide-slate-100">
                {so.deliveries.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      {d.docNo}{' '}
                      <span className="text-slate-500">
                        · {dateTh(d.docDate)}
                      </span>
                    </span>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {so.invoices.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium">ใบแจ้งหนี้</h2>
              <ul className="divide-y divide-slate-100">
                {so.invoices.map((inv) => (
                  <li key={inv.id} className="py-2">
                    <Link
                      href={`/sales/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-2 text-sm hover:underline"
                    >
                      <span className="text-sky-700">{inv.docNo}</span>
                      <StatusBadge status={inv.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {billable.length === 0 && so.invoices.length === 0 && (
            <p className="text-center text-sm text-slate-500">
              ยังไม่มีใบส่งของที่ยืนยันแล้ว — ต้องจ่ายของก่อนถึงจะวางบิลได้
            </p>
          )}
        </>
      )}
    </div>
  );
}
