'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Alert, Button, Card, Field, Input, Loading } from '@/components/ui';
import { ImageUpload } from '@/components/image-upload';
import { COSTING_LABEL, TRACKING_LABEL } from '@/lib/format';
import type { Category, Product, Uom } from '@/lib/types';

const selectClass =
  'tap-target w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-900';

interface FormState {
  sku: string;
  name: string;
  brand: string;
  model: string;
  categoryId: string;
  baseUomId: string;
  trackingType: 'NONE' | 'SERIAL' | 'LOT';
  costingMethod: 'AVG' | 'FIFO';
  warrantyMonths: string;
  priceRetail: string;
  priceContractor: string;
  priceProject: string;
  minStock: string;
  imagePublicId: string | null;
}

const emptyForm: FormState = {
  sku: '',
  name: '',
  brand: '',
  model: '',
  categoryId: '',
  baseUomId: '',
  trackingType: 'NONE',
  costingMethod: 'AVG',
  warrantyMonths: '0',
  priceRetail: '0',
  priceContractor: '0',
  priceProject: '0',
  minStock: '0',
  imagePublicId: null,
};

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const isEdit = Boolean(product);

  const [uoms, setUoms] = useState<Uom[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [form, setForm] = useState<FormState>(
    product
      ? {
          sku: product.sku,
          name: product.name,
          brand: product.brand ?? '',
          model: product.model ?? '',
          categoryId: product.categoryId ?? '',
          baseUomId: product.baseUomId,
          trackingType: product.trackingType,
          costingMethod: product.costingMethod,
          warrantyMonths: String(product.warrantyMonths),
          priceRetail: String(product.priceRetail),
          priceContractor: String(product.priceContractor),
          priceProject: String(product.priceProject),
          minStock: String(product.minStock),
          imagePublicId: product.imagePublicId,
        }
      : emptyForm,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([api<Uom[]>('uoms'), api<Category[]>('categories')])
      .then(([u, c]) => {
        setUoms(u);
        setCategories(c);
        setForm((f) => (f.baseUomId ? f : { ...f, baseUomId: u[0]?.id ?? '' }));
      })
      .catch(() => setError('โหลดข้อมูลหน่วยนับ/หมวดสินค้าไม่สำเร็จ'));
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      model: form.model.trim() || undefined,
      categoryId: form.categoryId || undefined,
      baseUomId: form.baseUomId,
      trackingType: form.trackingType,
      costingMethod: form.costingMethod,
      warrantyMonths: Number(form.warrantyMonths || 0),
      priceRetail: Number(form.priceRetail || 0),
      priceContractor: Number(form.priceContractor || 0),
      priceProject: Number(form.priceProject || 0),
      minStock: Number(form.minStock || 0),
      imagePublicId: form.imagePublicId ?? undefined,
    };

    try {
      const saved = isEdit
        ? await api<Product>(`products/${product!.id}`, {
            method: 'PATCH',
            // แก้ไขห้ามส่ง sku ซ้ำถ้าไม่ได้เปลี่ยน (backend เช็ค unique อยู่แล้ว)
            body: payload,
          })
        : await api<Product>('products', { method: 'POST', body: payload });

      // replace ไม่ push — กดถอยจากหน้ารายละเอียดต้องกลับไปหน้ารายการ ไม่ใช่ฟอร์มที่บันทึกไปแล้ว
      router.replace(`/products/${saved.id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง',
      );
      setSaving(false);
    }
  }

  if (!uoms || !categories) return <Loading label="กำลังเตรียมฟอร์ม…" />;

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
      {error && <Alert>{error}</Alert>}

      <Card className="space-y-4">
        <Field label="รหัสสินค้า (SKU) *" hint="ห้ามซ้ำกับสินค้าอื่น">
          <Input
            required
            value={form.sku}
            onChange={(e) => set('sku', e.target.value)}
            placeholder="เช่น AC-DK-12K"
          />
        </Field>

        <Field label="ชื่อสินค้า *">
          <Input
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="เช่น แอร์ติดผนัง 12000 BTU"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ยี่ห้อ">
            <Input
              value={form.brand}
              onChange={(e) => set('brand', e.target.value)}
              placeholder="Daikin"
            />
          </Field>
          <Field label="รุ่น">
            <Input
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="หมวดสินค้า">
            <select
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              className={selectClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="หน่วยนับหลัก *" hint="หน่วยที่ใช้เก็บสต๊อก เปลี่ยนทีหลังไม่ได้ง่าย">
            <select
              required
              value={form.baseUomId}
              onChange={(e) => set('baseUomId', e.target.value)}
              className={selectClass}
              disabled={isEdit}
            >
              {uoms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ImageUpload
          value={form.imagePublicId}
          previewUrl={product?.imageUrl ?? null}
          onChange={(publicId) => set('imagePublicId', publicId)}
        />
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">วิธีติดตามสินค้า</h2>

        <Field
          label="ประเภทการติดตาม"
          hint="แอร์/ตู้เย็น เลือกตามเครื่อง · ปูน/สี เลือกตามล็อต"
        >
          <select
            value={form.trackingType}
            onChange={(e) =>
              set('trackingType', e.target.value as FormState['trackingType'])
            }
            className={selectClass}
            disabled={isEdit}
          >
            {Object.entries(TRACKING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="วิธีคิดต้นทุน">
          <select
            value={form.costingMethod}
            onChange={(e) =>
              set('costingMethod', e.target.value as FormState['costingMethod'])
            }
            className={selectClass}
          >
            {Object.entries(COSTING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        {form.trackingType === 'SERIAL' && (
          <Field label="ประกัน (เดือน)" hint="นับจากวันที่ขายให้ลูกค้า">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.warrantyMonths}
              onChange={(e) => set('warrantyMonths', e.target.value)}
            />
          </Field>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="font-medium">ราคาขาย (ต่อหน่วยหลัก)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ราคาปลีก">
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={form.priceRetail}
              onChange={(e) => set('priceRetail', e.target.value)}
            />
          </Field>
          <Field label="ราคาช่าง">
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={form.priceContractor}
              onChange={(e) => set('priceContractor', e.target.value)}
            />
          </Field>
          <Field label="ราคาโครงการ">
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={form.priceProject}
              onChange={(e) => set('priceProject', e.target.value)}
            />
          </Field>
        </div>

        <Field label="จุดสั่งซื้อ (min stock)" hint="ต่ำกว่านี้ระบบจะเตือนให้สั่งของ">
          <Input
            type="number"
            min={0}
            step="0.001"
            inputMode="decimal"
            value={form.minStock}
            onChange={(e) => set('minStock', e.target.value)}
          />
        </Field>
      </Card>

      <div className="flex gap-3 pb-4">
        <Button type="submit" loading={saving} className="flex-1">
          {isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}
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
