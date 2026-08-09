'use client';

import { Card } from '@/components/ui';
import { StatusBadge } from '@/components/doc';
import { dateTh, money, qty as fmtQty } from '@/lib/format';

export interface DocLineView {
  id: string;
  qty: string;
  baseQty: string;
  unitPrice: string;
  lineTotal: string;
  qtyDelivered?: string;
  qtyReceived?: string;
  product: { sku: string; name: string };
  productUnit?: { uom: { name: string } } | null;
}

export function DocHeader({
  docNo,
  status,
  partnerName,
  docDate,
  extra,
}: {
  docNo: string;
  status: string;
  partnerName: string;
  docDate: string;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{docNo}</h1>
        <StatusBadge status={status} />
      </div>
      <p className="text-sm text-slate-500">
        {partnerName} · {dateTh(docDate)}
      </p>
      {extra}
    </div>
  );
}

/** ตารางรายการสินค้าในเอกสาร — บนมือถือแสดงเป็นการ์ดแทนตาราง (ไม่ต้องเลื่อนแนวนอน) */
export function DocLines({
  lines,
  baseUomFallback = '',
  showProgress,
}: {
  lines: DocLineView[];
  baseUomFallback?: string;
  showProgress?: 'delivered' | 'received';
}) {
  return (
    <Card>
      <h2 className="mb-2 font-medium">รายการสินค้า</h2>
      <ul className="divide-y divide-slate-100">
        {lines.map((l) => {
          const done =
            showProgress === 'delivered'
              ? Number(l.qtyDelivered ?? 0)
              : showProgress === 'received'
                ? Number(l.qtyReceived ?? 0)
                : null;
          const total = Number(l.baseQty);
          const remaining = done === null ? null : total - done;

          return (
            <li key={l.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.product.name}</p>
                  <p className="truncate text-sm text-slate-500">
                    {l.product.sku} · {fmtQty(l.qty)}{' '}
                    {l.productUnit?.uom.name ?? baseUomFallback} × ฿
                    {money(l.unitPrice)}
                  </p>
                </div>
                <span className="shrink-0 font-medium">
                  ฿{money(l.lineTotal)}
                </span>
              </div>

              {remaining !== null && (
                <p
                  className={`mt-1 text-sm ${
                    remaining > 0 ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {showProgress === 'delivered'
                    ? remaining > 0
                      ? `ค้างส่งอีก ${fmtQty(remaining)}`
                      : '✓ ส่งครบแล้ว'
                    : remaining > 0
                      ? `ค้างรับอีก ${fmtQty(remaining)}`
                      : '✓ รับครบแล้ว'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function DocSummary({
  subtotal,
  vatAmount,
  totalAmount,
  amountPaid,
  dueDate,
}: {
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  amountPaid?: string;
  dueDate?: string;
}) {
  const due =
    amountPaid !== undefined
      ? Number(totalAmount) - Number(amountPaid)
      : undefined;

  return (
    <Card className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-slate-500">ยอดก่อนภาษี</span>
        <span>฿{money(subtotal)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-500">ภาษีมูลค่าเพิ่ม</span>
        <span>฿{money(vatAmount)}</span>
      </div>
      <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
        <span>ยอดรวม</span>
        <span>฿{money(totalAmount)}</span>
      </div>

      {amountPaid !== undefined && (
        <>
          <div className="flex justify-between pt-1">
            <span className="text-slate-500">รับชำระแล้ว</span>
            <span className="text-emerald-700">฿{money(amountPaid)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>ค้างชำระ</span>
            <span className={due && due > 0 ? 'text-red-700' : 'text-emerald-700'}>
              ฿{money(due ?? 0)}
            </span>
          </div>
        </>
      )}

      {dueDate && (
        <p className="pt-1 text-slate-500">ครบกำหนดชำระ {dateTh(dueDate)}</p>
      )}
    </Card>
  );
}
