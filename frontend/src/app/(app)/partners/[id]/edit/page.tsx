'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { ErrorState, Loading } from '@/components/ui';
import { PartnerForm } from '@/components/partner-form';
import type { Partner } from '@/lib/types';

export default function EditPartnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Partner>(`partners/${id}`)
      .then(setPartner)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!partner) return <Loading />;

  return (
    <div className="space-y-4">
      <BackLink href={`/partners/${id}`} label="กลับไปหน้าคู่ค้า" />
      <h1 className="mx-auto max-w-2xl text-xl font-bold">
        แก้ไข {partner.name}
      </h1>
      <PartnerForm partner={partner} />
    </div>
  );
}
