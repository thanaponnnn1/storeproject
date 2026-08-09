'use client';

import { useState } from 'react';
import { Alert, Button, Card, Input } from '@/components/ui';
import { money, qty as fmtQty } from '@/lib/format';

export interface BasketLine {
  key: string;
  productId: string;
  sku: string;
  name: string;
  trackingType: 'NONE' | 'SERIAL' | 'LOT';
  baseUomName: string;
  /** หน่วยที่กรอกจำนวน (หน่วยที่ยิง หรือหน่วยของเอกสารต้นทาง) */
  unitName: string;
  /** 1 หน่วยข้างบน = กี่หน่วยฐาน */
  factor: number;
  qty: number;
  unitCost?: number;
  serials: string[];
  /** รับเข้า: ล็อตใหม่ */
  lotNo?: string;
  expiryDate?: string;
  /** จ่ายออก: ล็อตที่เลือกจากรายการ FEFO */
  lotId?: string;
  lotLabel?: string;
  /** ผูกกับบรรทัดของใบสั่งซื้อ/สั่งขาย */
  docLineId?: string;
  /** จำนวนสูงสุดที่ใส่ได้ (ยอดค้างรับ/ค้างส่ง หรือยอดคงเหลือ) */
  maxQty?: number;
  maxLabel?: string;
}

export interface LotOption {
  id: string;
  lotNo: string;
  remainingQty: string;
  daysToExpiry: number | null;
  isExpired: boolean;
}

/** ปัญหาที่ทำให้ยืนยันไม่ได้ — บอกทีละบรรทัดว่าติดอะไร */
export function lineProblem(line: BasketLine, mode: 'in' | 'out'): string | null {
  if (line.qty <= 0) return 'ใส่จำนวนก่อน';
  if (line.maxQty !== undefined && line.qty > line.maxQty) {
    return `เกินที่ทำได้ (${fmtQty(line.maxQty)} ${line.unitName})`;
  }
  if (line.trackingType === 'SERIAL') {
    const need = line.qty * line.factor;
    if (line.serials.length !== need) {
      return `ต้องยิง serial ให้ครบ ${need} เครื่อง (ตอนนี้ ${line.serials.length})`;
    }
  }
  if (line.trackingType === 'LOT') {
    if (mode === 'in' && !line.lotNo?.trim()) return 'ใส่เลขล็อตก่อน';
    if (mode === 'out' && !line.lotId) return 'เลือกล็อตที่จะจ่ายก่อน';
  }
  if (mode === 'in' && (line.unitCost === undefined || line.unitCost < 0)) {
    return 'ใส่ทุนต่อหน่วยก่อน';
  }
  return null;
}

export function BasketLineCard({
  line,
  mode,
  lots,
  onChange,
  onRemove,
  onScanSerial,
}: {
  line: BasketLine;
  mode: 'in' | 'out';
  lots?: LotOption[];
  onChange: (patch: Partial<BasketLine>) => void;
  onRemove: () => void;
  onScanSerial?: () => void;
}) {
  const [manualSerial, setManualSerial] = useState('');
  const problem = lineProblem(line, mode);
  const baseQty = line.qty * line.factor;

  return (
    <Card className={problem ? 'border-amber-300' : ''}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{line.name}</p>
          <p className="truncate text-sm text-slate-500">
            {line.sku}
            {line.maxLabel ? ` · ${line.maxLabel}` : ''}
          </p>
        </div>
        <button
          onClick={onRemove}
          aria-label={`เอา ${line.name} ออกจากรายการ`}
          className="shrink-0 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          เอาออก
        </button>
      </div>

      {/* จำนวน: ปุ่ม +/- ใหญ่ ๆ กดด้วยนิ้วโป้งได้ ไม่ต้องพิมพ์ */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          aria-label="ลดจำนวน"
          onClick={() => onChange({ qty: Math.max(0, line.qty - 1) })}
          className="w-14"
        >
          −
        </Button>
        <div className="flex-1">
          <Input
            type="number"
            min={0}
            step="0.001"
            inputMode="decimal"
            value={line.qty}
            aria-label={`จำนวน ${line.name}`}
            onChange={(e) => onChange({ qty: Number(e.target.value) })}
            className="text-center text-lg font-bold"
            disabled={line.trackingType === 'SERIAL'}
          />
        </div>
        <Button
          variant="secondary"
          aria-label="เพิ่มจำนวน"
          onClick={() => onChange({ qty: line.qty + 1 })}
          className="w-14"
        >
          +
        </Button>
        <span className="w-16 shrink-0 text-sm text-slate-600">
          {line.unitName}
        </span>
      </div>

      {line.factor !== 1 && (
        <p className="mt-1 text-center text-xs text-slate-500">
          = {fmtQty(baseQty)} {line.baseUomName}
        </p>
      )}

      {/* ทุนต่อหน่วย (เฉพาะตอนรับเข้า) */}
      {mode === 'in' && (
        <label className="mt-3 block">
          <span className="text-sm text-slate-600">
            ทุนต่อ 1 {line.unitName}
          </span>
          <Input
            type="number"
            min={0}
            step="0.0001"
            inputMode="decimal"
            value={line.unitCost ?? ''}
            onChange={(e) => onChange({ unitCost: Number(e.target.value) })}
            placeholder="0.00"
          />
          {line.qty > 0 && line.unitCost ? (
            <span className="mt-1 block text-xs text-slate-500">
              รวม ฿{money(line.qty * line.unitCost)}
            </span>
          ) : null}
        </label>
      )}

      {/* สินค้าตามล็อต */}
      {line.trackingType === 'LOT' && mode === 'in' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-slate-600">เลขล็อต *</span>
            <Input
              value={line.lotNo ?? ''}
              onChange={(e) => onChange({ lotNo: e.target.value })}
              placeholder="เช่น TPI-2026-08"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">วันหมดอายุ</span>
            <Input
              type="date"
              value={line.expiryDate ?? ''}
              onChange={(e) => onChange({ expiryDate: e.target.value })}
            />
          </label>
        </div>
      )}

      {line.trackingType === 'LOT' && mode === 'out' && (
        <label className="mt-3 block">
          <span className="text-sm text-slate-600">
            ล็อตที่จ่าย (เรียงตามที่ควรจ่ายก่อน)
          </span>
          <select
            value={line.lotId ?? ''}
            onChange={(e) => {
              const lot = lots?.find((l) => l.id === e.target.value);
              onChange({ lotId: e.target.value, lotLabel: lot?.lotNo });
            }}
            className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3"
          >
            <option value="">— เลือกล็อต —</option>
            {lots?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lotNo} · เหลือ {fmtQty(l.remainingQty)}
                {l.isExpired
                  ? ' · หมดอายุแล้ว'
                  : l.daysToExpiry !== null
                    ? ` · อีก ${l.daysToExpiry} วัน`
                    : ''}
              </option>
            ))}
          </select>
          {lots?.length === 0 && (
            <span className="mt-1 block text-xs text-amber-700">
              ไม่มีล็อตที่มีของเหลือในคลังนี้
            </span>
          )}
        </label>
      )}

      {/* สินค้าตามเครื่อง: ยิง serial ทีละเครื่อง */}
      {line.trackingType === 'SERIAL' && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">
              serial ({line.serials.length} เครื่อง)
            </span>
            {onScanSerial && (
              <button
                onClick={onScanSerial}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                📷 ยิง serial
              </button>
            )}
          </div>

          {line.serials.length > 0 && (
            <ul className="space-y-1">
              {line.serials.map((s) => (
                <li
                  key={s}
                  className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5 text-sm"
                >
                  <code className="truncate">{s}</code>
                  <button
                    onClick={() =>
                      onChange({
                        serials: line.serials.filter((x) => x !== s),
                        qty: (line.serials.length - 1) / line.factor,
                      })
                    }
                    aria-label={`เอา serial ${s} ออก`}
                    className="shrink-0 text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const s = manualSerial.trim();
              if (!s || line.serials.includes(s)) return;
              onChange({
                serials: [...line.serials, s],
                qty: (line.serials.length + 1) / line.factor,
              });
              setManualSerial('');
            }}
            className="flex gap-2"
          >
            <Input
              value={manualSerial}
              onChange={(e) => setManualSerial(e.target.value)}
              placeholder="พิมพ์ serial ด้วยมือ"
              aria-label="พิมพ์ serial ด้วยมือ"
              enterKeyHint="enter"
            />
            <Button type="submit" variant="secondary" disabled={!manualSerial.trim()}>
              เพิ่ม
            </Button>
          </form>
        </div>
      )}

      {problem && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠️ {problem}
        </p>
      )}
    </Card>
  );
}

/** แถบสรุปล่างจอ — เห็นตลอดว่ามีกี่รายการและยืนยันได้หรือยัง */
export function BasketBar({
  lines,
  mode,
  submitting,
  error,
  onSubmit,
  onClear,
}: {
  lines: BasketLine[];
  mode: 'in' | 'out';
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const problems = lines.filter((l) => lineProblem(l, mode));
  const ready = lines.length > 0 && problems.length === 0;

  return (
    <div className="sticky bottom-16 z-10 space-y-2 lg:bottom-0">
      {error && <Alert>{error}</Alert>}

      <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">
            {lines.length} รายการ
            {problems.length > 0 && (
              <span className="text-amber-700">
                {' '}
                · ยังกรอกไม่ครบ {problems.length} รายการ
              </span>
            )}
          </span>
          {lines.length > 0 && (
            <button
              onClick={onClear}
              disabled={submitting}
              className="text-slate-500 hover:text-red-600"
            >
              ล้างทั้งหมด
            </button>
          )}
        </div>

        <Button
          onClick={onSubmit}
          disabled={!ready}
          loading={submitting}
          className="w-full"
        >
          {mode === 'in' ? 'ยืนยันรับของเข้าคลัง' : 'ยืนยันจ่ายของออก'}
        </Button>
      </div>
    </div>
  );
}
