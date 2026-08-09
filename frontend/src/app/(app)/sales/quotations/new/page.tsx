'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import {
  DocLineRow,
  DocTotals,
  LinePicker,
  type DocLineInput,
} from '@/components/doc';
import { Alert, Button, Card, Field, Input, Loading } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { PRICE_LEVEL_LABEL } from '@/lib/format';
import type { Partner } from '@/lib/types';

export default function NewQuotationPage() {
  const router = useRouter();
  const canEditPrice = useCan(['ADMIN', 'MANAGER']);

  const [customers, setCustomers] = useState<Partner[] | null>(null);
  const [partnerId, setPartnerId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<DocLineInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<{ data: Partner[] }>('partners?type=CUSTOMER&limit=100')
      .then((r) => setCustomers(r.data))
      .catch(() => setError('โหลดรายชื่อลูกค้าไม่สำเร็จ'));
  }, []);

  const partner = customers?.find((c) => c.id === partnerId);
  const priceLevel = partner?.priceLevel ?? 'RETAIL';

  // เปลี่ยนลูกค้าแล้วราคาต้องเปลี่ยนตามระดับของลูกค้าคนใหม่
  function changePartner(id: string) {
    setPartnerId(id);
    if (lines.length > 0) {
      setLines([]);
      setError('เปลี่ยนลูกค้าแล้ว — ล้างรายการเดิมเพราะราคาคนละระดับ');
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const qt = await api<{ id: string }>('quotations', {
        method: 'POST',
        body: {
          partnerId,
          validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
          remark: remark.trim() || undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            // ส่งราคาไปเฉพาะตอนที่แก้จริง ๆ (คนไม่มีสิทธิ์แก้จะโดน 403)
            ...(l.unitPrice !== l.suggestedPrice
              ? { unitPrice: l.unitPrice }
              : {}),
          })),
        },
      });
      router.replace(`/sales/quotations/${qt.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ');
      setSaving(false);
    }
  }

  if (!customers) return <Loading label="กำลังโหลดรายชื่อลูกค้า…" />;

  const ready = partnerId && lines.length > 0 && lines.every((l) => l.qty > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/sales" label="กลับไปงานขาย" />
      <h1 className="text-xl font-bold">ใบเสนอราคาใหม่</h1>

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-4">
        <Field label="ลูกค้า *">
          <select
            value={partnerId}
            onChange={(e) => changePartner(e.target.value)}
            className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3"
          >
            <option value="">— เลือกลูกค้า —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({PRICE_LEVEL_LABEL[c.priceLevel]})
              </option>
            ))}
          </select>
        </Field>

        {partner && (
          <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">
            ราคาจะดึงเป็น{PRICE_LEVEL_LABEL[partner.priceLevel]}ให้อัตโนมัติ ·
            เครดิต{' '}
            {partner.creditTermDays > 0
              ? `${partner.creditTermDays} วัน`
              : 'เงินสด'}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ยืนราคาถึงวันที่">
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </Field>
          <Field label="หมายเหตุ">
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
          </Field>
        </div>
      </Card>

      {partnerId && (
        <Card>
          <h2 className="mb-2 font-medium">เพิ่มรายการสินค้า</h2>
          <LinePicker
            priceLevel={priceLevel}
            onAdd={(line) =>
              setLines((ls) => {
                const existing = ls.find((l) => l.productId === line.productId);
                if (existing) {
                  return ls.map((l) =>
                    l.key === existing.key ? { ...l, qty: l.qty + 1 } : l,
                  );
                }
                return [...ls, { ...line, key: line.productId }];
              })
            }
          />
        </Card>
      )}

      {lines.length > 0 && (
        <>
          <ul className="space-y-3">
            {lines.map((line) => (
              <li key={line.key}>
                <DocLineRow
                  line={line}
                  canEditPrice={canEditPrice}
                  onChange={(patch) =>
                    setLines((ls) =>
                      ls.map((l) =>
                        l.key === line.key ? { ...l, ...patch } : l,
                      ),
                    )
                  }
                  onRemove={() =>
                    setLines((ls) => ls.filter((l) => l.key !== line.key))
                  }
                />
              </li>
            ))}
          </ul>
          <DocTotals lines={lines} />
        </>
      )}

      <div className="sticky bottom-16 flex gap-3 rounded-xl border border-slate-300 bg-white p-3 shadow-lg lg:bottom-0">
        <Button
          onClick={() => void submit()}
          disabled={!ready}
          loading={saving}
          className="flex-1"
        >
          บันทึกใบเสนอราคา
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.back()}
          disabled={saving}
        >
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}
