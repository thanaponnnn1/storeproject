'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { LinePicker, type DocLineInput } from '@/components/doc';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Loading,
} from '@/components/ui';
import { money } from '@/lib/format';
import type { Partner, Warehouse } from '@/lib/types';

/** บรรทัดใบสั่งซื้อใช้ "ทุน" ไม่ใช่ราคาขาย — ต่อรองกันทุกครั้ง ไม่มีราคาอัตโนมัติ */
type PoLine = DocLineInput;

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Partner[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<PoLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([
      api<{ data: Partner[] }>('partners?limit=100'),
      api<Warehouse[]>('warehouses'),
    ])
      .then(([p, w]) => {
        // ซื้อได้เฉพาะคู่ค้าที่เป็นซัพพลายเออร์
        setSuppliers(
          p.data.filter((x) => x.type === 'SUPPLIER' || x.type === 'BOTH'),
        );
        setWarehouses(w);
        setWarehouseId(w[0]?.id ?? '');
      })
      .catch(() => setError('โหลดข้อมูลตั้งต้นไม่สำเร็จ'));
  }, []);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const po = await api<{ id: string }>('purchase-orders', {
        method: 'POST',
        body: {
          partnerId,
          warehouseId,
          expectedDate: expectedDate
            ? new Date(expectedDate).toISOString()
            : undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitCost: l.unitPrice,
          })),
        },
      });
      router.replace(`/purchases/orders/${po.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ');
      setSaving(false);
    }
  }

  if (!suppliers) return <Loading label="กำลังโหลดรายชื่อซัพพลายเออร์…" />;

  const ready =
    partnerId && warehouseId && lines.length > 0 && lines.every((l) => l.qty > 0);
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/purchases" label="กลับไปงานซื้อ" />
      <h1 className="text-xl font-bold">ใบสั่งซื้อใหม่</h1>

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-4">
        <Field label="ซัพพลายเออร์ *">
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3"
          >
            <option value="">— เลือกซัพพลายเออร์ —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="รับเข้าคลัง *">
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="กำหนดรับของ">
            <Input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {partnerId && (
        <Card>
          <h2 className="mb-2 font-medium">เพิ่มรายการสินค้า</h2>
          <LinePicker
            priceLevel="RETAIL"
            onAdd={(line) =>
              setLines((ls) => {
                const existing = ls.find((l) => l.productId === line.productId);
                if (existing) {
                  return ls.map((l) =>
                    l.key === existing.key ? { ...l, qty: l.qty + 1 } : l,
                  );
                }
                // ราคาซื้อไม่มีค่าตั้งต้น ต้องกรอกเอง (ต่อรองทุกครั้ง)
                return [
                  ...ls,
                  { ...line, key: line.productId, unitPrice: 0, suggestedPrice: 0 },
                ];
              })
            }
          />
        </Card>
      )}

      {lines.map((line) => (
        <Card key={line.key}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{line.name}</p>
              <p className="truncate text-sm text-slate-500">
                {line.sku} · หน่วย {line.unitName}
              </p>
            </div>
            <button
              onClick={() =>
                setLines((ls) => ls.filter((l) => l.key !== line.key))
              }
              className="shrink-0 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              เอาออก
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="จำนวน">
              <Input
                type="number"
                min={0.001}
                step="0.001"
                inputMode="decimal"
                value={line.qty}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l) =>
                      l.key === line.key
                        ? { ...l, qty: Number(e.target.value) }
                        : l,
                    ),
                  )
                }
              />
            </Field>
            <Field label="ทุนต่อหน่วย *">
              <Input
                type="number"
                min={0}
                step="0.0001"
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l) =>
                      l.key === line.key
                        ? { ...l, unitPrice: Number(e.target.value) }
                        : l,
                    ),
                  )
                }
              />
            </Field>
          </div>

          <p className="mt-2 text-right text-sm font-medium">
            รวม ฿{money(line.qty * line.unitPrice)}
          </p>
        </Card>
      ))}

      {lines.length > 0 && (
        <Card className="flex justify-between text-base font-bold">
          <span>ยอดรวม (ก่อน VAT)</span>
          <span>฿{money(total)}</span>
        </Card>
      )}

      <div className="sticky bottom-16 flex gap-3 rounded-xl border border-slate-300 bg-white p-3 shadow-lg lg:bottom-0">
        <Button
          onClick={() => void submit()}
          disabled={!ready}
          loading={saving}
          className="flex-1"
        >
          บันทึกใบสั่งซื้อ
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
