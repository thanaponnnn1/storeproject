'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Alert, Card, Loading } from '@/components/ui';
import { dateTh, money, qty } from '@/lib/format';
import type { Product, Uom } from '@/lib/types';

interface ScannedUnit {
  productUnitId: string | null;
  uom: Uom;
  conversionFactor: string;
  salePrice: string | null;
}

interface StockRow {
  warehouse: { code: string; name: string };
  qtyOnHand: string;
  qtyInScannedUnit: string;
  avgCost: string;
}

interface BarcodeHit {
  kind: 'product';
  code: string;
  product: Product;
  scannedUnit: ScannedUnit;
  stock: StockRow[];
}

interface SerialHit {
  kind: 'serial';
  code: string;
  serial: string;
  status: string;
  soldAt: string | null;
  product: { id: string; sku: string; name: string; brand: string | null };
  warehouse: { code: string; name: string } | null;
  soldToPartner: { code: string; name: string; phone: string | null } | null;
  warranty: {
    months: number;
    endAt: string | null;
    daysLeft: number | null;
    inWarranty: boolean;
  };
}

type Hit = BarcodeHit | SerialHit;

const SERIAL_STATUS: Record<string, { label: string; tone: string }> = {
  IN_STOCK: { label: 'อยู่ในคลัง', tone: 'bg-emerald-100 text-emerald-800' },
  SOLD: { label: 'ขายแล้ว', tone: 'bg-sky-100 text-sky-800' },
  CLAIMED: { label: 'ส่งเคลม', tone: 'bg-amber-100 text-amber-800' },
  RETURNED: { label: 'รับคืน', tone: 'bg-slate-100 text-slate-700' },
};

export default function ScanPage() {
  const [hit, setHit] = useState<Hit | null>(null);
  const [history, setHistory] = useState<Hit[]>([]);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const lookup = useCallback(async (code: string) => {
    setLooking(true);
    setNotFound(null);

    try {
      // ลองหาเป็นบาร์โค้ดสินค้าก่อน
      const found = await api<{
        product: Product;
        scannedUnit: ScannedUnit;
        stock: StockRow[];
      }>(`products/by-barcode/${encodeURIComponent(code)}`);

      const next: BarcodeHit = { kind: 'product', code, ...found };
      setHit(next);
      setHistory((h) => [next, ...h].slice(0, 10));
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) {
        setNotFound(e instanceof ApiError ? e.message : 'ค้นหาไม่สำเร็จ');
        setLooking(false);
        return;
      }
    }

    try {
      // ไม่ใช่บาร์โค้ดสินค้า → ลองเป็น serial บนตัวเครื่อง (หน้าเคลม)
      const serial = await api<Omit<SerialHit, 'kind' | 'code'>>(
        `inventory/serials/${encodeURIComponent(code)}`,
      );
      const next: SerialHit = { kind: 'serial', code, ...serial };
      setHit(next);
      setHistory((h) => [next, ...h].slice(0, 10));
    } catch {
      setHit(null);
      setNotFound(code);
    } finally {
      setLooking(false);
    }
    setLooking(false);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">สแกนบาร์โค้ด</h1>
        <p className="text-sm text-slate-500">
          ยิงบาร์โค้ดสินค้า หรือ serial บนตัวเครื่องเพื่อเช็คประกัน
        </p>
      </div>

      <BarcodeScanner onScan={(code) => void lookup(code)} />

      {looking && <Loading label="กำลังค้นหา…" />}

      {notFound && !looking && (
        <Alert tone="warning">
          <p className="font-medium">ไม่พบรหัส “{notFound}” ในระบบ</p>
          <p className="mt-1">
            อาจเป็นสินค้าที่ยังไม่ได้ผูกบาร์โค้ด —{' '}
            <Link
              href={`/products?search=${encodeURIComponent(notFound)}`}
              className="underline"
            >
              ลองค้นหาจากชื่อ/รหัสสินค้า
            </Link>
          </p>
        </Alert>
      )}

      {hit && !looking && <HitCard hit={hit} />}

      {history.length > 1 && (
        <Card>
          <h2 className="mb-2 font-medium">ยิงล่าสุด</h2>
          <ul className="divide-y divide-slate-100">
            {history.slice(1).map((h, i) => (
              <li key={`${h.code}-${i}`} className="py-2 text-sm">
                <button
                  onClick={() => setHit(h)}
                  className="w-full text-left hover:underline"
                >
                  <span className="font-medium">
                    {h.kind === 'product' ? h.product.name : h.product.name}
                  </span>
                  <span className="ml-2 text-slate-500">{h.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function HitCard({ hit }: { hit: Hit }) {
  if (hit.kind === 'serial') {
    const status = SERIAL_STATUS[hit.status] ?? {
      label: hit.status,
      tone: 'bg-slate-100',
    };
    return (
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">เครื่องหมายเลข</p>
            <p className="font-mono text-lg font-bold">{hit.serial}</p>
          </div>
          <span className={`rounded px-2 py-1 text-sm ${status.tone}`}>
            {status.label}
          </span>
        </div>

        <div>
          <p className="text-lg font-medium">{hit.product.name}</p>
          <p className="text-sm text-slate-500">
            {hit.product.sku}
            {hit.product.brand ? ` · ${hit.product.brand}` : ''}
          </p>
        </div>

        {/* ข้อมูลที่หน้าเคลมต้องใช้ — ตอบลูกค้าได้ทันทีว่าประกันเหลือไหม */}
        <div
          className={`rounded-lg p-3 ${
            hit.warranty.inWarranty
              ? 'bg-emerald-50 text-emerald-900'
              : hit.status === 'SOLD'
                ? 'bg-red-50 text-red-900'
                : 'bg-slate-50 text-slate-700'
          }`}
        >
          {hit.status !== 'SOLD' ? (
            <p>ยังไม่ได้ขาย — ประกัน {hit.warranty.months} เดือนจะเริ่มนับวันที่ขาย</p>
          ) : hit.warranty.inWarranty ? (
            <>
              <p className="font-medium">
                ✅ อยู่ในประกัน เหลืออีก {hit.warranty.daysLeft} วัน
              </p>
              <p className="text-sm">หมดประกัน {dateTh(hit.warranty.endAt)}</p>
            </>
          ) : (
            <>
              <p className="font-medium">❌ หมดประกันแล้ว</p>
              <p className="text-sm">
                หมดเมื่อ {dateTh(hit.warranty.endAt)} — คิดค่าบริการตามปกติ
              </p>
            </>
          )}
        </div>

        <div className="divide-y divide-slate-100 text-sm">
          {hit.soldAt && (
            <div className="flex justify-between py-2">
              <span className="text-slate-500">วันที่ขาย</span>
              <span className="font-medium">{dateTh(hit.soldAt)}</span>
            </div>
          )}
          {hit.soldToPartner && (
            <div className="flex justify-between gap-3 py-2">
              <span className="text-slate-500">ลูกค้า</span>
              <span className="text-right font-medium">
                {hit.soldToPartner.name}
                {hit.soldToPartner.phone && (
                  <>
                    {' · '}
                    <a
                      href={`tel:${hit.soldToPartner.phone}`}
                      className="text-sky-700"
                    >
                      {hit.soldToPartner.phone}
                    </a>
                  </>
                )}
              </span>
            </div>
          )}
          {hit.warehouse && (
            <div className="flex justify-between py-2">
              <span className="text-slate-500">อยู่คลัง</span>
              <span className="font-medium">{hit.warehouse.name}</span>
            </div>
          )}
        </div>

        <Link
          href={`/products/${hit.product.id}`}
          className="inline-block text-sm text-sky-700 hover:underline"
        >
          ดูข้อมูลสินค้า →
        </Link>
      </Card>
    );
  }

  const factor = Number(hit.scannedUnit.conversionFactor);
  const totalBase = hit.stock.reduce((s, r) => s + Number(r.qtyOnHand), 0);

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        {hit.product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hit.product.imageUrl}
            alt={hit.product.name}
            className="size-16 shrink-0 rounded-lg border border-slate-200 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-medium">{hit.product.name}</p>
          <p className="text-sm text-slate-500">
            {hit.product.sku}
            {hit.product.brand ? ` · ${hit.product.brand}` : ''}
          </p>
        </div>
      </div>

      {/* ยอดคงเหลือคือสิ่งที่หน้างานอยากรู้ที่สุด — ตัวใหญ่ที่สุดบนการ์ด */}
      <div className="rounded-lg bg-slate-900 p-4 text-center text-white">
        <p className="text-xs text-slate-300">คงเหลือทั้งหมด</p>
        <p className="text-3xl font-bold">
          {qty(totalBase)}{' '}
          <span className="text-lg font-normal">
            {hit.product.baseUom?.name}
          </span>
        </p>
        {factor !== 1 && (
          <p className="mt-1 text-sm text-slate-300">
            = {qty(totalBase / factor)} {hit.scannedUnit.uom.name} (ยิง 1{' '}
            {hit.scannedUnit.uom.name} = {qty(factor)}{' '}
            {hit.product.baseUom?.name})
          </p>
        )}
      </div>

      {hit.stock.length > 1 && (
        <div className="divide-y divide-slate-100 text-sm">
          {hit.stock.map((row) => (
            <div key={row.warehouse.code} className="flex justify-between py-2">
              <span className="text-slate-500">{row.warehouse.name}</span>
              <span className="font-medium">
                {qty(row.qtyOnHand)} {hit.product.baseUom?.code}
              </span>
            </div>
          ))}
        </div>
      )}

      {hit.stock.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          ยังไม่มีของในคลัง (ยังไม่เคยรับเข้า)
        </p>
      )}

      <div className="divide-y divide-slate-100 text-sm">
        <div className="flex justify-between py-2">
          <span className="text-slate-500">
            ราคาขาย ({hit.scannedUnit.uom.name})
          </span>
          <span className="font-medium">
            ฿{money(hit.scannedUnit.salePrice ?? hit.product.priceRetail)}
          </span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-slate-500">บาร์โค้ดที่ยิง</span>
          <span className="font-mono text-xs">{hit.code}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Link
          href={`/stock/${hit.product.id}`}
          className="tap-target flex flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium"
        >
          ดูความเคลื่อนไหว
        </Link>
        <Link
          href={`/products/${hit.product.id}`}
          className="tap-target flex flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium"
        >
          ข้อมูลสินค้า
        </Link>
      </div>
    </Card>
  );
}
