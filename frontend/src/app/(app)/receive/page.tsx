'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { BarcodeScanner } from '@/components/barcode-scanner';
import {
  BasketBar,
  BasketLineCard,
  lineProblem,
  type BasketLine,
} from '@/components/scan-basket';
import { Alert, Card, Loading } from '@/components/ui';
import { qty as fmtQty } from '@/lib/format';
import type { Product, Uom, Warehouse } from '@/lib/types';

interface PoLine {
  id: string;
  productId: string;
  qty: string;
  baseQty: string;
  qtyReceived: string;
  unitCost: string;
  product: { sku: string; name: string; trackingType: string };
  productUnit: { conversionFactor: string; uom: Uom } | null;
}

interface PurchaseOrder {
  id: string;
  docNo: string;
  status: string;
  partner: { code: string; name: string };
  warehouseId: string;
  lines: PoLine[];
}

export default function ReceivePage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [pos, setPos] = useState<{ id: string; docNo: string; partner: { name: string } }[]>([]);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  /** บรรทัดที่กำลังยิง serial อยู่ — ยิงรหัสที่ไม่ใช่สินค้าจะถือเป็น serial ของบรรทัดนี้ */
  const serialTargetRef = useRef<string | null>(null);
  const [serialTarget, setSerialTarget] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<Warehouse[]>('warehouses'),
      api<{ data: { id: string; docNo: string; partner: { name: string } }[] }>(
        'purchase-orders?status=APPROVED&limit=50',
      ),
      api<{ data: { id: string; docNo: string; partner: { name: string } }[] }>(
        'purchase-orders?status=PARTIALLY_RECEIVED&limit=50',
      ),
    ])
      .then(([whs, approved, partial]) => {
        setWarehouses(whs);
        setWarehouseId(whs[0]?.id ?? '');
        setPos([...approved.data, ...partial.data]);
        setReady(true);
      })
      .catch(() => {
        setError('โหลดข้อมูลตั้งต้นไม่สำเร็จ');
        setReady(true);
      });
  }, []);

  async function pickPo(id: string) {
    setLines([]);
    setNotice(null);
    if (!id) {
      setPo(null);
      return;
    }
    try {
      const full = await api<PurchaseOrder>(`purchase-orders/${id}`);
      setPo(full);
      setWarehouseId(full.warehouseId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เปิดใบสั่งซื้อไม่สำเร็จ');
    }
  }

  const setLine = (key: string, patch: Partial<BasketLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const handleScan = useCallback(
    async (code: string) => {
      setNotice(null);
      setError(null);

      // กำลังยิง serial ให้บรรทัดไหนอยู่ → รหัสที่ยิงมาถือเป็น serial
      const target = serialTargetRef.current;
      if (target) {
        setLines((ls) =>
          ls.map((l) => {
            if (l.key !== target) return l;
            if (l.serials.includes(code)) return l;
            const serials = [...l.serials, code];
            return { ...l, serials, qty: serials.length / l.factor };
          }),
        );
        setNotice(`เพิ่ม serial ${code} แล้ว`);
        return;
      }

      try {
        const found = await api<{
          product: Product;
          scannedUnit: {
            uom: Uom;
            conversionFactor: string;
            productUnitId: string | null;
          };
          stock: { qtyOnHand: string; avgCost: string }[];
        }>(`products/by-barcode/${encodeURIComponent(code)}`);

        const p = found.product;

        // โหมดมีใบสั่งซื้อ: ของที่ยิงต้องอยู่ในใบนั้น และรับได้ไม่เกินยอดค้าง
        if (po) {
          const poLine = po.lines.find((l) => l.productId === p.id);
          if (!poLine) {
            setError(
              `"${p.name}" ไม่ได้อยู่ในใบสั่งซื้อ ${po.docNo} — ตรวจว่าหยิบของถูกใบไหม`,
            );
            return;
          }
          const factor = Number(poLine.productUnit?.conversionFactor ?? 1);
          const remaining =
            (Number(poLine.baseQty) - Number(poLine.qtyReceived)) / factor;
          if (remaining <= 0) {
            setError(`"${p.name}" รับครบตามใบสั่งซื้อแล้ว`);
            return;
          }

          const existing = lines.find((l) => l.docLineId === poLine.id);
          if (existing) {
            if (existing.trackingType !== 'SERIAL') {
              setLine(existing.key, {
                qty: Math.min(existing.qty + 1, remaining),
              });
            }
            setNotice(`${p.name} — เพิ่มจำนวนแล้ว`);
            return;
          }

          setLines((ls) => [
            ...ls,
            {
              key: poLine.id,
              productId: p.id,
              sku: p.sku,
              name: p.name,
              trackingType: p.trackingType,
              baseUomName: p.baseUom?.name ?? '',
              unitName: poLine.productUnit?.uom.name ?? p.baseUom?.name ?? '',
              factor,
              qty: p.trackingType === 'SERIAL' ? 0 : 1,
              unitCost: Number(poLine.unitCost),
              serials: [],
              docLineId: poLine.id,
              maxQty: remaining,
              maxLabel: `ค้างรับ ${fmtQty(remaining)}`,
            },
          ]);
          setNotice(`เพิ่ม ${p.name}`);
          return;
        }

        // โหมดรับเร็ว: ใช้หน่วยของบาร์โค้ดที่ยิง
        const factor = Number(found.scannedUnit.conversionFactor);
        const key = `${p.id}:${found.scannedUnit.productUnitId ?? 'base'}`;
        const existing = lines.find((l) => l.key === key);
        if (existing) {
          if (existing.trackingType !== 'SERIAL') {
            setLine(key, { qty: existing.qty + 1 });
          }
          setNotice(`${p.name} — เพิ่มจำนวนแล้ว`);
          return;
        }

        setLines((ls) => [
          ...ls,
          {
            key,
            productId: p.id,
            sku: p.sku,
            name: p.name,
            trackingType: p.trackingType,
            baseUomName: p.baseUom?.name ?? '',
            unitName: found.scannedUnit.uom.name,
            factor,
            qty: p.trackingType === 'SERIAL' ? 0 : 1,
            // เดาทุนจากทุนเฉลี่ยล่าสุด ผู้ใช้แก้ได้ (ราคาซื้อเปลี่ยนทุกครั้ง)
            unitCost: found.stock[0]
              ? Number(found.stock[0].avgCost) * factor
              : 0,
            serials: [],
          },
        ]);
        setNotice(`เพิ่ม ${p.name}`);
      } catch (e) {
        setError(
          e instanceof ApiError && e.status === 404
            ? `ไม่พบสินค้าจากรหัส "${code}" — ถ้าเป็นของใหม่ต้องเพิ่มสินค้าและผูกบาร์โค้ดก่อน`
            : e instanceof ApiError
              ? e.message
              : 'ค้นหาไม่สำเร็จ',
        );
      }
    },
    [lines, po],
  );

  function toggleSerialTarget(key: string) {
    const next = serialTargetRef.current === key ? null : key;
    serialTargetRef.current = next;
    setSerialTarget(next);
    setNotice(
      next ? 'ยิง serial บนตัวเครื่องได้เลย ยิงต่อเนื่องได้ทีละเครื่อง' : null,
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const refDocId = `RCV-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-5)}`;

    try {
      if (po) {
        // สร้างใบรับของจากใบสั่งซื้อ แล้วยืนยันให้ของเข้าสต๊อกทันที
        const gr = await api<{ id: string; docNo: string }>('goods-receipts', {
          method: 'POST',
          body: {
            purchaseOrderId: po.id,
            lines: lines.map((l) => ({
              poLineId: l.docLineId,
              qty: l.qty,
              unitCost: l.unitCost,
              serials: l.serials.length ? l.serials : undefined,
              lotNo: l.lotNo || undefined,
              expiryDate: l.expiryDate
                ? new Date(l.expiryDate).toISOString()
                : undefined,
            })),
          },
        });
        await api(`goods-receipts/${gr.id}/confirm`, { method: 'PATCH' });
        router.push(`/purchases?done=${gr.docNo}`);
        return;
      }

      // รับเร็ว: ลง ledger ทีละรายการ
      for (const l of lines) {
        await api('inventory/receipts', {
          method: 'POST',
          body: {
            productId: l.productId,
            warehouseId,
            qty: l.qty * l.factor,
            unitCost: (l.unitCost ?? 0) / l.factor,
            refDocType: 'MANUAL',
            refDocId,
            serials: l.serials.length ? l.serials : undefined,
            lotNo: l.lotNo || undefined,
            expiryDate: l.expiryDate
              ? new Date(l.expiryDate).toISOString()
              : undefined,
            note: 'รับเข้าจากหน้าสแกน',
          },
        });
      }
      router.push(`/stock?received=${refDocId}`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง',
      );
      setSubmitting(false);
    }
  }

  // โครงหน้าขึ้นทันที ไม่ต้องรอโหลดใบสั่งซื้อ — เปิดกล้องยิงได้เลย
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">รับของเข้าคลัง</h1>
        <p className="text-sm text-slate-500">
          ยิงบาร์โค้ดสะสมเป็นรายการ แล้วยืนยันทีเดียว
        </p>
      </div>

      <Card className="space-y-3">
        {!ready && <Loading label="กำลังโหลดใบสั่งซื้อ…" />}
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            รับตามใบสั่งซื้อ
          </span>
          <select
            value={po?.id ?? ''}
            onChange={(e) => void pickPo(e.target.value)}
            disabled={lines.length > 0}
            className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3 disabled:bg-slate-100"
          >
            <option value="">— รับเข้าเลย ไม่มีใบสั่งซื้อ —</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.docNo} · {p.partner.name}
              </option>
            ))}
          </select>
          {lines.length > 0 && (
            <span className="mt-1 block text-xs text-slate-500">
              เปลี่ยนใบสั่งซื้อไม่ได้แล้ว — ล้างรายการก่อนถ้าต้องการเปลี่ยน
            </span>
          )}
        </label>

        {!po && warehouses.length > 1 && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              รับเข้าคลัง
            </span>
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
          </label>
        )}

        {po && (
          <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">
            รับตาม {po.docNo} · {po.partner.name} — ยิงได้เฉพาะของในใบนี้
            และไม่เกินยอดค้างรับ
          </p>
        )}
      </Card>

      <BarcodeScanner onScan={(code) => void handleScan(code)} />

      {serialTarget && (
        <Alert tone="info">
          กำลังยิง serial ให้ &ldquo;
          {lines.find((l) => l.key === serialTarget)?.name}&rdquo; — กดปุ่ม
          &ldquo;ยิง serial&rdquo; อีกครั้งเพื่อหยุด
        </Alert>
      )}
      {notice && <Alert tone="info">{notice}</Alert>}

      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-slate-600">
          ยังไม่มีรายการ — ยิงบาร์โค้ดสินค้าเพื่อเริ่ม
        </div>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.key}>
              <BasketLineCard
                line={line}
                mode="in"
                onChange={(patch) => setLine(line.key, patch)}
                onRemove={() => {
                  if (serialTargetRef.current === line.key) {
                    serialTargetRef.current = null;
                    setSerialTarget(null);
                  }
                  setLines((ls) => ls.filter((l) => l.key !== line.key));
                }}
                onScanSerial={() => toggleSerialTarget(line.key)}
              />
            </li>
          ))}
        </ul>
      )}

      <BasketBar
        lines={lines}
        mode="in"
        submitting={submitting}
        error={error}
        onSubmit={() => void submit()}
        onClear={() => {
          if (!window.confirm('ล้างรายการที่ยิงไว้ทั้งหมดใช่ไหม?')) return;
          setLines([]);
          serialTargetRef.current = null;
          setSerialTarget(null);
        }}
      />
    </div>
  );
}
