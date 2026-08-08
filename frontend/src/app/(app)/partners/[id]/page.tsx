'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { Alert, Button, Card, ErrorState, Loading } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { PARTNER_TYPE_LABEL, PRICE_LEVEL_LABEL } from '@/lib/format';
import type { Partner } from '@/lib/types';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const canEdit = useCan(['ADMIN', 'MANAGER']);

  const [partner, setPartner] = useState<Partner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<Partner>(`partners/${id}`)
      .then(setPartner)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  async function toggleActive() {
    if (!partner) return;
    const ok = window.confirm(
      partner.isActive
        ? `ปิดใช้งาน "${partner.name}" ใช่ไหม?\n\nจะเปิดเอกสารใหม่ให้คู่ค้ารายนี้ไม่ได้ (เอกสารเก่ายังอยู่ครบ)`
        : `เปิดใช้งาน "${partner.name}" อีกครั้งใช่ไหม?`,
    );
    if (!ok) return;

    setBusy(true);
    setActionError(null);
    try {
      const updated = await api<Partner>(`partners/${id}`, {
        method: 'PATCH',
        body: { isActive: !partner.isActive },
      });
      setPartner({ ...partner, isActive: updated.isActive });
    } catch (e) {
      setActionError(
        e instanceof ApiError ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/partners" label="กลับไปรายการคู่ค้า" />

      <div>
        {partner ? (
          <>
            <h1 className="text-xl font-bold">{partner.name}</h1>
            <p className="text-sm text-slate-500">
              {partner.code} · {PARTNER_TYPE_LABEL[partner.type]}
            </p>
            {!partner.isActive && (
              <span className="mt-1 inline-block rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                ปิดใช้งานอยู่
              </span>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
          </div>
        )}
      </div>

      {actionError && <Alert>{actionError}</Alert>}

      {canEdit && (
        <div className="flex gap-2">
          <Link href={`/partners/${id}/edit`} className="flex-1">
            <Button className="w-full">แก้ไขข้อมูล</Button>
          </Link>
          {partner && (
            <Button
              variant={partner.isActive ? 'danger' : 'secondary'}
              loading={busy}
              onClick={toggleActive}
            >
              {partner.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </Button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!partner && !error && <Loading />}

      {partner && (
        <>
      <Card>
        <h2 className="mb-2 font-medium">ข้อมูลติดต่อ</h2>
        <div className="divide-y divide-slate-100">
          <Row
            label="เบอร์โทร"
            value={
              partner.phone ? (
                <a href={`tel:${partner.phone}`} className="text-sky-700">
                  {partner.phone}
                </a>
              ) : (
                '-'
              )
            }
          />
          <Row label="เลขผู้เสียภาษี" value={partner.taxId ?? '-'} />
          <Row label="ที่อยู่" value={partner.address ?? '-'} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">เงื่อนไขการค้า</h2>
        <div className="divide-y divide-slate-100">
          {partner.type !== 'SUPPLIER' && (
            <Row
              label="ระดับราคา"
              value={PRICE_LEVEL_LABEL[partner.priceLevel]}
            />
          )}
          <Row
            label="เครดิต"
            value={
              partner.creditTermDays > 0
                ? `${partner.creditTermDays} วัน`
                : 'เงินสด'
            }
          />
        </div>
      </Card>
        </>
      )}
    </div>
  );
}
