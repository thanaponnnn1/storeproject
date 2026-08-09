'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { DocAction } from '@/components/doc';
import { DocHeader, DocLines, DocSummary, type DocLineView } from '@/components/doc-detail';
import { Card, ErrorState, Loading } from '@/components/ui';
import { useCan } from '@/components/user-context';
import type { Warehouse } from '@/lib/types';

interface Quotation {
  id: string;
  docNo: string;
  status: string;
  docDate: string;
  validUntil: string | null;
  remark: string | null;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  partner: { code: string; name: string; priceLevel: string };
  lines: DocLineView[];
  salesOrders: { id: string; docNo: string; status: string }[];
}

export default function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const canApprove = useCan(['ADMIN', 'MANAGER']);
  const canWork = useCan(['ADMIN', 'MANAGER', 'SALES']);

  const [qt, setQt] = useState<Quotation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const load = useCallback(() => {
    setError(null);
    api<Quotation>(`quotations/${id}`)
      .then(setQt)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดเอกสารไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => {
    void api<Warehouse[]>('warehouses')
      .then(setWarehouses)
      .catch(() => setWarehouses([]));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/sales" label="กลับไปงานขาย" />

      {error && <ErrorState message={error} onRetry={load} />}
      {!qt && !error && <Loading />}

      {qt && (
        <>
          <DocHeader
            docNo={qt.docNo}
            status={qt.status}
            partnerName={qt.partner.name}
            docDate={qt.docDate}
          />

          {/* ปุ่มที่กดได้ขึ้นอยู่กับสถานะ — ไม่โชว์ปุ่มที่กดแล้วเจอ error */}
          {canWork && (
            <div className="flex flex-wrap gap-2">
              {qt.status === 'DRAFT' && (
                <>
                  <DocAction
                    label="ส่งขออนุมัติ"
                    onDone={load}
                    action={() =>
                      api(`quotations/${id}/submit`, { method: 'PATCH' })
                    }
                  />
                  <Link href={`/sales/quotations/${id}/edit`} className="flex-1">
                    <span className="tap-target flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 font-medium">
                      แก้ไข
                    </span>
                  </Link>
                </>
              )}

              {qt.status === 'SUBMITTED' && canApprove && (
                <DocAction
                  label="อนุมัติ"
                  onDone={load}
                  action={() =>
                    api(`quotations/${id}/approve`, { method: 'PATCH' })
                  }
                />
              )}

              {qt.status === 'APPROVED' && (
                <DocAction
                  label="แปลงเป็นใบสั่งขาย"
                  confirm="แปลงใบเสนอราคานี้เป็นใบสั่งขายใช่ไหม?&#10;&#10;หลังแปลงแล้วจะแก้ใบเสนอราคาไม่ได้อีก"
                  onDone={() => router.refresh()}
                  action={async () => {
                    const so = await api<{ id: string }>(
                      `quotations/${id}/convert`,
                      {
                        method: 'POST',
                        body: { warehouseId: warehouses[0]?.id },
                      },
                    );
                    router.push(`/sales/orders/${so.id}`);
                  }}
                />
              )}

              {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(qt.status) &&
                canApprove && (
                  <DocAction
                    label="ยกเลิก"
                    variant="danger"
                    confirm="ยกเลิกใบเสนอราคานี้ใช่ไหม? ยกเลิกแล้วย้อนกลับไม่ได้"
                    onDone={load}
                    action={() =>
                      api(`quotations/${id}/cancel`, { method: 'PATCH' })
                    }
                  />
                )}
            </div>
          )}

          {qt.salesOrders.length > 0 && (
            <Card>
              <h2 className="mb-2 font-medium">ใบสั่งขายที่เกิดจากใบนี้</h2>
              <ul className="space-y-2">
                {qt.salesOrders.map((so) => (
                  <li key={so.id}>
                    <Link
                      href={`/sales/orders/${so.id}`}
                      className="text-sky-700 hover:underline"
                    >
                      {so.docNo} →
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <DocLines lines={qt.lines} />
          <DocSummary
            subtotal={qt.subtotal}
            vatAmount={qt.vatAmount}
            totalAmount={qt.totalAmount}
          />

          {qt.remark && (
            <Card>
              <h2 className="mb-1 font-medium">หมายเหตุ</h2>
              <p className="text-sm text-slate-600">{qt.remark}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
