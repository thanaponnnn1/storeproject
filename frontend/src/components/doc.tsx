'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';
import { money, qty as fmtQty } from '@/lib/format';
import type { Product } from '@/lib/types';

/** ป้ายสถานะเอกสาร — สีเดียวกันทั้งระบบเพื่อให้กวาดตาแล้วรู้ทันที */
const STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'ฉบับร่าง', tone: 'bg-slate-100 text-slate-700' },
  SUBMITTED: { label: 'รออนุมัติ', tone: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'อนุมัติแล้ว', tone: 'bg-emerald-100 text-emerald-800' },
  CONVERTED: { label: 'แปลงเป็นใบสั่งขายแล้ว', tone: 'bg-sky-100 text-sky-800' },
  EXPIRED: { label: 'หมดอายุ', tone: 'bg-slate-200 text-slate-600' },
  CANCELLED: { label: 'ยกเลิก', tone: 'bg-red-100 text-red-700' },
  CONFIRMED: { label: 'ยืนยันแล้ว', tone: 'bg-emerald-100 text-emerald-800' },
  PARTIALLY_DELIVERED: { label: 'ส่งบางส่วน', tone: 'bg-amber-100 text-amber-800' },
  DELIVERED: { label: 'ส่งครบแล้ว', tone: 'bg-sky-100 text-sky-800' },
  PARTIALLY_RECEIVED: { label: 'รับบางส่วน', tone: 'bg-amber-100 text-amber-800' },
  RECEIVED: { label: 'รับครบแล้ว', tone: 'bg-sky-100 text-sky-800' },
  CLOSED: { label: 'ปิดงาน', tone: 'bg-slate-200 text-slate-600' },
  ISSUED: { label: 'วางบิลแล้ว', tone: 'bg-amber-100 text-amber-800' },
  PARTIALLY_PAID: { label: 'จ่ายบางส่วน', tone: 'bg-amber-100 text-amber-800' },
  PAID: { label: 'จ่ายครบแล้ว', tone: 'bg-emerald-100 text-emerald-800' },
  VOID: { label: 'ยกเลิก', tone: 'bg-red-100 text-red-700' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'bg-slate-100' };
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${s.tone}`}>
      {s.label}
    </span>
  );
}

export interface DocLineInput {
  key: string;
  productId: string;
  productUnitId?: string;
  sku: string;
  name: string;
  unitName: string;
  qty: number;
  unitPrice: number;
  /** ราคาที่ระบบดึงให้ตามระดับลูกค้า — ไว้เทียบว่ามีการแก้ราคาหรือไม่ */
  suggestedPrice: number;
}

/**
 * เลือกสินค้าเข้าเอกสาร — ค้นจากชื่อ/รหัส หรือยิงบาร์โค้ดก็ได้
 * ราคาดึงตามระดับลูกค้าให้อัตโนมัติ (แก้ได้เฉพาะคนมีสิทธิ์)
 */
export function LinePicker({
  priceLevel,
  onAdd,
}: {
  priceLevel: 'RETAIL' | 'CONTRACTOR' | 'PROJECT';
  onAdd: (line: Omit<DocLineInput, 'key'>) => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (term.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => {
      void api<{ data: Product[] }>(
        `products?search=${encodeURIComponent(term.trim())}&limit=8`,
      )
        .then((r) => setResults(r.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [term]);

  function priceOf(p: Product): number {
    return Number(
      priceLevel === 'CONTRACTOR'
        ? p.priceContractor
        : priceLevel === 'PROJECT'
          ? p.priceProject
          : p.priceRetail,
    );
  }

  function add(p: Product) {
    const price = priceOf(p);
    onAdd({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unitName: p.baseUom?.name ?? '',
      qty: 1,
      unitPrice: price,
      suggestedPrice: price,
    });
    setTerm('');
    setResults(null);
  }

  return (
    <div className="space-y-2">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="พิมพ์ชื่อ/รหัสสินค้าเพื่อเพิ่มรายการ"
        aria-label="ค้นหาสินค้าเพื่อเพิ่มเข้าเอกสาร"
      />

      {searching && <p className="text-sm text-slate-500">กำลังค้นหา…</p>}

      {results && results.length === 0 && !searching && (
        <p className="text-sm text-slate-500">
          ไม่พบสินค้าที่ตรงกับ “{term}”
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {results.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => add(p)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block truncate text-sm text-slate-500">
                    {p.sku} · หน่วย {p.baseUom?.name}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium">
                    ฿{money(priceOf(p))}
                  </span>
                  <span className="text-xs text-slate-500">+ เพิ่ม</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** บรรทัดสินค้าในเอกสารที่กำลังร่าง */
export function DocLineRow({
  line,
  canEditPrice,
  onChange,
  onRemove,
}: {
  line: DocLineInput;
  canEditPrice: boolean;
  onChange: (patch: Partial<DocLineInput>) => void;
  onRemove: () => void;
}) {
  const changed = line.unitPrice !== line.suggestedPrice;
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{line.name}</p>
          <p className="truncate text-sm text-slate-500">
            {line.sku} · หน่วย {line.unitName}
          </p>
        </div>
        <button
          onClick={onRemove}
          aria-label={`เอา ${line.name} ออก`}
          className="shrink-0 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          เอาออก
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm text-slate-600">จำนวน</span>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              aria-label="ลดจำนวน"
              onClick={() => onChange({ qty: Math.max(1, line.qty - 1) })}
              className="w-12 px-0"
            >
              −
            </Button>
            <Input
              type="number"
              min={0.001}
              step="0.001"
              inputMode="decimal"
              value={line.qty}
              onChange={(e) => onChange({ qty: Number(e.target.value) })}
              className="text-center font-bold"
            />
            <Button
              variant="secondary"
              aria-label="เพิ่มจำนวน"
              onClick={() => onChange({ qty: line.qty + 1 })}
              className="w-12 px-0"
            >
              +
            </Button>
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-slate-600">
            ราคา/หน่วย{!canEditPrice && ' (ตามระดับลูกค้า)'}
          </span>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={line.unitPrice}
            disabled={!canEditPrice}
            onChange={(e) => onChange({ unitPrice: Number(e.target.value) })}
            className="disabled:bg-slate-100"
          />
        </label>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        {changed ? (
          <span className="text-amber-700">
            แก้ราคาจาก ฿{money(line.suggestedPrice)}
          </span>
        ) : (
          <span />
        )}
        <span className="font-medium">
          รวม ฿{money(line.qty * line.unitPrice)}
        </span>
      </div>
    </Card>
  );
}

/** สรุปยอดท้ายเอกสาร — ตัวเลขต้องตรงกับที่ backend คำนวณ */
export function DocTotals({
  lines,
  vatRate = 7,
}: {
  lines: { qty: number; unitPrice: number }[];
  vatRate?: number;
}) {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const vat = Math.round(subtotal * vatRate) / 100;
  return (
    <Card className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-slate-500">ยอดก่อนภาษี</span>
        <span>฿{money(subtotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">ภาษีมูลค่าเพิ่ม {vatRate}%</span>
        <span>฿{money(vat)}</span>
      </div>
      <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
        <span>ยอดรวม</span>
        <span>฿{money(subtotal + vat)}</span>
      </div>
    </Card>
  );
}

/** ปุ่มเปลี่ยนสถานะเอกสาร — ยืนยันก่อนเสมอถ้าเป็นงานที่ถอยยาก */
export function DocAction({
  label,
  confirm,
  variant = 'primary',
  onDone,
  action,
}: {
  label: string;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onDone: () => void;
  action: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1">
      <Button
        variant={variant}
        loading={busy}
        onClick={() => void run()}
        className="w-full"
      >
        {label}
      </Button>
      {error && (
        <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

/** แถวเอกสารในรายการ — ใช้ร่วมกันทุกประเภท */
export function DocRow({
  href,
  docNo,
  status,
  partnerName,
  date,
  amount,
  hint,
}: {
  href: string;
  docNo: string;
  status: string;
  partnerName: string;
  date: string;
  amount?: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-400 active:scale-[0.99]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{docNo}</span>
          <StatusBadge status={status} />
        </div>
        <p className="truncate text-sm text-slate-500">
          {partnerName} · {date}
          {hint ? ` · ${hint}` : ''}
        </p>
      </div>
      {amount !== undefined && (
        <span className="shrink-0 font-medium">฿{money(amount)}</span>
      )}
      <span aria-hidden className="shrink-0 text-slate-400">
        ›
      </span>
    </Link>
  );
}

export { fmtQty };
