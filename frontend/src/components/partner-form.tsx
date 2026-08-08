'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { PARTNER_TYPE_LABEL, PRICE_LEVEL_LABEL } from '@/lib/format';
import type { Partner } from '@/lib/types';

const selectClass =
  'tap-target w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-900';

export function PartnerForm({ partner }: { partner?: Partner }) {
  const router = useRouter();
  const isEdit = Boolean(partner);

  const [form, setForm] = useState({
    code: partner?.code ?? '',
    name: partner?.name ?? '',
    type: partner?.type ?? ('CUSTOMER' as Partner['type']),
    taxId: partner?.taxId ?? '',
    phone: partner?.phone ?? '',
    address: partner?.address ?? '',
    creditTermDays: String(partner?.creditTermDays ?? 0),
    priceLevel: partner?.priceLevel ?? ('RETAIL' as Partner['priceLevel']),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      taxId: form.taxId.trim() || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      creditTermDays: Number(form.creditTermDays || 0),
      priceLevel: form.priceLevel,
    };

    try {
      const saved = isEdit
        ? await api<Partner>(`partners/${partner!.id}`, {
            method: 'PATCH',
            body: payload,
          })
        : await api<Partner>('partners', { method: 'POST', body: payload });

      router.replace(`/partners/${saved.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง',
      );
      setSaving(false);
    }
  }

  const isSupplierOnly = form.type === 'SUPPLIER';

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
      {error && <Alert>{error}</Alert>}

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="รหัส *" hint="เช่น C-0001 (ลูกค้า) หรือ S-0001 (ซัพพลายเออร์)">
            <Input
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>

          <Field label="ประเภท *">
            <select
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
              className={selectClass}
            >
              {Object.entries(PARTNER_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="ชื่อ *">
          <Input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="เช่น ช่างสมชาย รับเหมาไฟฟ้า"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="เบอร์โทร">
            <Input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="08x-xxx-xxxx"
            />
          </Field>
          <Field label="เลขผู้เสียภาษี">
            <Input
              inputMode="numeric"
              value={form.taxId}
              onChange={(e) => set('taxId', e.target.value)}
            />
          </Field>
        </div>

        <Field label="ที่อยู่">
          <textarea
            rows={3}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white p-3 outline-none focus:border-slate-900"
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">เงื่อนไขการค้า</h2>

        {!isSupplierOnly && (
          <Field
            label="ระดับราคา"
            hint="เปิดบิลให้ลูกค้ารายนี้จะดึงราคาระดับนี้อัตโนมัติ"
          >
            <select
              value={form.priceLevel}
              onChange={(e) => set('priceLevel', e.target.value)}
              className={selectClass}
            >
              {Object.entries(PRICE_LEVEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="เครดิต (วัน)" hint="0 = เงินสด · ใช้คำนวณวันครบกำหนดชำระ">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={form.creditTermDays}
            onChange={(e) => set('creditTermDays', e.target.value)}
          />
        </Field>
      </Card>

      <div className="flex gap-3 pb-4">
        <Button type="submit" loading={saving} className="flex-1">
          {isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มคู่ค้า'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={saving}
        >
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}
