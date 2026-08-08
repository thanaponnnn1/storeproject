'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { BarcodeTag } from '@/components/barcode-tag';
import { Alert, Button, Card, ErrorState, Loading } from '@/components/ui';
import { useCan } from '@/components/user-context';
import { COSTING_LABEL, TRACKING_LABEL, money, qty } from '@/lib/format';
import type { Product } from '@/lib/types';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const canEdit = useCan(['ADMIN', 'MANAGER']);

  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<Product>(`products/${id}`)
      .then(setProduct)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  async function toggleActive() {
    if (!product) return;
    const turningOff = product.isActive;
    // งานที่กระทบการใช้งานจริงต้องยืนยันก่อน พร้อมบอกผลที่จะเกิด
    const ok = window.confirm(
      turningOff
        ? `ปิดใช้งาน "${product.name}" ใช่ไหม?\n\nสินค้าจะไม่ขึ้นในรายการและเปิดเอกสารใหม่ไม่ได้ (ของในคลังยังอยู่เหมือนเดิม)`
        : `เปิดใช้งาน "${product.name}" อีกครั้งใช่ไหม?`,
    );
    if (!ok) return;

    setBusy(true);
    setActionError(null);
    try {
      const updated = await api<Product>(`products/${id}`, {
        method: 'PATCH',
        body: { isActive: !product.isActive },
      });
      setProduct({ ...product, isActive: updated.isActive });
    } catch (e) {
      setActionError(
        e instanceof ApiError ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ',
      );
    } finally {
      setBusy(false);
    }
  }

  // โครงหน้าขึ้นทันทีไม่ต้องรอข้อมูล — ผู้ใช้เห็นว่ามาถูกหน้าแล้วและกดปุ่มได้เลย
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackLink href="/products" label="กลับไปรายการสินค้า" />

      <div className="flex items-start gap-4">
        {product?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="size-20 shrink-0 rounded-lg border border-slate-200 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          {product ? (
            <>
              <h1 className="text-xl font-bold">{product.name}</h1>
              <p className="text-sm text-slate-500">
                {product.sku}
                {product.brand ? ` · ${product.brand}` : ''}
                {product.model ? ` ${product.model}` : ''}
              </p>
              {!product.isActive && (
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
      </div>

      {actionError && <Alert>{actionError}</Alert>}

      {canEdit && (
        <div className="flex gap-2">
          <Link href={`/products/${id}/edit`} className="flex-1">
            <Button className="w-full">แก้ไขข้อมูล</Button>
          </Link>
          {product && (
            <Button
              variant={product.isActive ? 'danger' : 'secondary'}
              loading={busy}
              onClick={toggleActive}
            >
              {product.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </Button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!product && !error && <Loading />}

      {product && (
        <>
      <Card>
        <h2 className="mb-2 font-medium">ข้อมูลทั่วไป</h2>
        <div className="divide-y divide-slate-100">
          <Row label="หมวด" value={product.category?.name ?? '-'} />
          <Row
            label="หน่วยนับหลัก"
            value={`${product.baseUom?.name} (${product.baseUom?.code})`}
          />
          <Row
            label="การติดตาม"
            value={TRACKING_LABEL[product.trackingType]}
          />
          <Row
            label="วิธีคิดต้นทุน"
            value={COSTING_LABEL[product.costingMethod]}
          />
          {product.trackingType === 'SERIAL' && (
            <Row label="ประกัน" value={`${product.warrantyMonths} เดือน`} />
          )}
          <Row label="จุดสั่งซื้อ" value={qty(product.minStock)} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">ราคาขาย</h2>
        <div className="divide-y divide-slate-100">
          <Row label="ราคาปลีก" value={`฿${money(product.priceRetail)}`} />
          <Row label="ราคาช่าง" value={`฿${money(product.priceContractor)}`} />
          <Row label="ราคาโครงการ" value={`฿${money(product.priceProject)}`} />
        </div>
      </Card>

      {product.units && product.units.length > 0 && (
        <Card>
          <h2 className="mb-2 font-medium">หน่วยขายอื่น</h2>
          <div className="divide-y divide-slate-100">
            {product.units.map((u) => (
              <Row
                key={u.id}
                label={`1 ${u.uom.name} = ${qty(u.conversionFactor)} ${product.baseUom?.name}`}
                value={u.salePrice ? `฿${money(u.salePrice)}` : '-'}
              />
            ))}
          </div>
        </Card>
      )}

      {product.barcodes && product.barcodes.length > 0 && (
        <Card>
          <h2 className="mb-2 font-medium">บาร์โค้ด</h2>
          <ul className="space-y-3">
            {product.barcodes.map((b) => {
              const unitName =
                b.productUnit?.uom.name ?? product.baseUom?.name ?? '';
              return (
                <li key={b.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <code className="truncate rounded bg-slate-100 px-2 py-1">
                      {b.barcode}
                    </code>
                    <span className="shrink-0 text-slate-500">
                      {unitName}
                      {b.isInternal ? ' · QR ของร้าน' : ''}
                    </span>
                  </div>
                  {/* ของที่ไม่มีบาร์โค้ดโรงงาน ต้องพิมพ์ป้ายเองถึงจะยิงได้ */}
                  {b.isInternal && (
                    <BarcodeTag
                      code={b.barcode}
                      productName={product.name}
                      sku={product.sku}
                      unitName={unitName}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
        </>
      )}
    </div>
  );
}
