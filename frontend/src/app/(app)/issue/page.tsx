'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { BarcodeScanner } from '@/components/barcode-scanner';
import {
  BasketBar,
  BasketLineCard,
  type BasketLine,
  type LotOption,
} from '@/components/scan-basket';
import { Alert, Card, Loading } from '@/components/ui';
import { qty as fmtQty } from '@/lib/format';
import type { Product, Uom, Warehouse } from '@/lib/types';

interface SoLine {
  id: string;
  productId: string;
  baseQty: string;
  qtyDelivered: string;
  product: { sku: string; name: string; trackingType: string };
  productUnit: { conversionFactor: string; uom: Uom } | null;
}

interface SalesOrder {
  id: string;
  docNo: string;
  partner: { code: string; name: string };
  partnerId: string;
  warehouseId: string;
  lines: SoLine[];
}

export default function IssuePage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [sos, setSos] = useState<{ id: string; docNo: string; partner: { name: string } }[]>([]);
  const [so, setSo] = useState<SalesOrder | null>(null);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, LotOption[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  const serialTargetRef = useRef<string | null>(null);
  const [serialTarget, setSerialTarget] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<Warehouse[]>('warehouses'),
      api<{ data: { id: string; docNo: string; partner: { name: string } }[] }>(
        'sales-orders?status=CONFIRMED&limit=50',
      ),
      api<{ data: { id: string; docNo: string; partner: { name: string } }[] }>(
        'sales-orders?status=PARTIALLY_DELIVERED&limit=50',
      ),
    ])
      .then(([whs, confirmed, partial]) => {
        setWarehouses(whs);
        setWarehouseId(whs[0]?.id ?? '');
        setSos([...confirmed.data, ...partial.data]);
        setReady(true);
      })
      .catch(() => {
        setError('โหลดข้อมูลตั้งต้นไม่สำเร็จ');
        setReady(true);
      });
  }, []);

  async function pickSo(id: string) {
    setLines([]);
    setNotice(null);
    if (!id) {
      setSo(null);
      return;
    }
    try {
      const full = await api<SalesOrder>(`sales-orders/${id}`);
      setSo(full);
      setWarehouseId(full.warehouseId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เปิดใบสั่งขายไม่สำเร็จ');
    }
  }

  const setLine = (key: string, patch: Partial<BasketLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /** สินค้าตามล็อตต้องรู้ว่ามีล็อตไหนให้จ่ายบ้าง (เรียงใกล้หมดอายุก่อน) */
  async function loadLots(productId: string, whId: string) {
    if (lotsByProduct[productId]) return;
    const lots = await api<LotOption[]>(
      `inventory/lots?productId=${productId}&warehouseId=${whId}`,
    ).catch(() => []);
    setLotsByProduct((m) => ({ ...m, [productId]: lots }));
  }

  const handleScan = useCallback(
    async (code: string) => {
      setNotice(null);
      setError(null);

      const target = serialTargetRef.current;
      if (target) {
        // ยิง serial ของที่จะจ่าย — ต้องมีอยู่จริงและอยู่ในคลังนี้
        try {
          const serial = await api<{
            serial: string;
            status: string;
            product: { id: string };
          }>(`inventory/serials/${encodeURIComponent(code)}`);

          const line = lines.find((l) => l.key === target);
          if (!line) return;
          if (serial.product.id !== line.productId) {
            setError(`serial ${code} ไม่ใช่ของ "${line.name}"`);
            return;
          }
          if (serial.status !== 'IN_STOCK') {
            setError(
              `serial ${code} สถานะ ${serial.status} — จ่ายออกไม่ได้ (อาจขายไปแล้ว)`,
            );
            return;
          }
          if (line.serials.includes(code)) {
            setNotice(`ยิง ${code} ไปแล้ว`);
            return;
          }
          setLines((ls) =>
            ls.map((l) => {
              if (l.key !== target) return l;
              const serials = [...l.serials, code];
              return { ...l, serials, qty: serials.length / l.factor };
            }),
          );
          setNotice(`เพิ่ม serial ${code} แล้ว`);
        } catch {
          setError(`ไม่พบ serial "${code}" ในระบบ`);
        }
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
          stock: { warehouse: { code: string }; qtyOnHand: string }[];
        }>(`products/by-barcode/${encodeURIComponent(code)}`);

        const p = found.product;
        const onHandBase = Number(found.stock[0]?.qtyOnHand ?? 0);

        if (so) {
          const soLine = so.lines.find((l) => l.productId === p.id);
          if (!soLine) {
            setError(
              `"${p.name}" ไม่ได้อยู่ในใบสั่งขาย ${so.docNo} — ตรวจว่าหยิบของถูกใบไหม`,
            );
            return;
          }
          const factor = Number(soLine.productUnit?.conversionFactor ?? 1);
          const remaining =
            (Number(soLine.baseQty) - Number(soLine.qtyDelivered)) / factor;
          if (remaining <= 0) {
            setError(`"${p.name}" ส่งครบตามใบสั่งขายแล้ว`);
            return;
          }

          const existing = lines.find((l) => l.docLineId === soLine.id);
          if (existing) {
            if (existing.trackingType !== 'SERIAL') {
              setLine(existing.key, {
                qty: Math.min(existing.qty + 1, remaining),
              });
            }
            setNotice(`${p.name} — เพิ่มจำนวนแล้ว`);
            return;
          }

          if (p.trackingType === 'LOT') await loadLots(p.id, so.warehouseId);

          setLines((ls) => [
            ...ls,
            {
              key: soLine.id,
              productId: p.id,
              sku: p.sku,
              name: p.name,
              trackingType: p.trackingType,
              baseUomName: p.baseUom?.name ?? '',
              unitName: soLine.productUnit?.uom.name ?? p.baseUom?.name ?? '',
              factor,
              qty: p.trackingType === 'SERIAL' ? 0 : 1,
              serials: [],
              docLineId: soLine.id,
              maxQty: remaining,
              maxLabel: `ค้างส่ง ${fmtQty(remaining)} · ในคลัง ${fmtQty(onHandBase)}`,
            },
          ]);
          setNotice(`เพิ่ม ${p.name}`);
          return;
        }

        // จ่ายเร็ว: กันไว้ไม่ให้เกินยอดคงเหลือตั้งแต่หน้าจอ
        const factor = Number(found.scannedUnit.conversionFactor);
        const maxInUnit = onHandBase / factor;
        if (maxInUnit <= 0) {
          setError(`"${p.name}" ไม่มีของในคลังนี้แล้ว`);
          return;
        }

        const key = `${p.id}:${found.scannedUnit.productUnitId ?? 'base'}`;
        const existing = lines.find((l) => l.key === key);
        if (existing) {
          if (existing.trackingType !== 'SERIAL') {
            setLine(key, { qty: Math.min(existing.qty + 1, maxInUnit) });
          }
          setNotice(`${p.name} — เพิ่มจำนวนแล้ว`);
          return;
        }

        if (p.trackingType === 'LOT') await loadLots(p.id, warehouseId);

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
            serials: [],
            maxQty: maxInUnit,
            maxLabel: `คงเหลือ ${fmtQty(maxInUnit)} ${found.scannedUnit.uom.name}`,
          },
        ]);
        setNotice(`เพิ่ม ${p.name}`);
      } catch (e) {
        setError(
          e instanceof ApiError && e.status === 404
            ? `ไม่พบสินค้าจากรหัส "${code}"`
            : e instanceof ApiError
              ? e.message
              : 'ค้นหาไม่สำเร็จ',
        );
      }
    },
    [lines, so, warehouseId, lotsByProduct],
  );

  function toggleSerialTarget(key: string) {
    const next = serialTargetRef.current === key ? null : key;
    serialTargetRef.current = next;
    setSerialTarget(next);
    setNotice(next ? 'ยิง serial บนตัวเครื่องที่จะจ่ายออกได้เลย' : null);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const refDocId = `ISS-${new Date().toISOString().slice(0, 10)}-${Date.now().toString().slice(-5)}`;

    try {
      if (so) {
        const doc = await api<{ id: string; docNo: string }>('deliveries', {
          method: 'POST',
          body: {
            salesOrderId: so.id,
            lines: lines.map((l) => ({
              soLineId: l.docLineId,
              qty: l.qty,
              serials: l.serials.length ? l.serials : undefined,
              lotId: l.lotId || undefined,
            })),
          },
        });
        await api(`deliveries/${doc.id}/confirm`, { method: 'PATCH' });
        router.push(`/sales?done=${doc.docNo}`);
        return;
      }

      for (const l of lines) {
        await api('inventory/issues', {
          method: 'POST',
          body: {
            productId: l.productId,
            warehouseId,
            qty: l.qty * l.factor,
            refDocType: 'MANUAL',
            refDocId,
            serials: l.serials.length ? l.serials : undefined,
            lotId: l.lotId || undefined,
            note: 'จ่ายออกจากหน้าสแกน',
          },
        });
      }
      router.push(`/stock?issued=${refDocId}`);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง',
      );
      setSubmitting(false);
    }
  }

  // โครงหน้าขึ้นทันที ไม่ต้องรอโหลดใบสั่งขาย — เปิดกล้องยิงได้เลย
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">จ่ายของออกจากคลัง</h1>
        <p className="text-sm text-slate-500">
          ยิงบาร์โค้ดสะสมเป็นรายการ แล้วยืนยันทีเดียว
        </p>
      </div>

      <Card className="space-y-3">
        {!ready && <Loading label="กำลังโหลดใบสั่งขาย…" />}
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            ส่งตามใบสั่งขาย
          </span>
          <select
            value={so?.id ?? ''}
            onChange={(e) => void pickSo(e.target.value)}
            disabled={lines.length > 0}
            className="tap-target w-full rounded-lg border border-slate-300 bg-white px-3 disabled:bg-slate-100"
          >
            <option value="">— จ่ายออกเลย ไม่มีใบสั่งขาย —</option>
            {sos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.docNo} · {s.partner.name}
              </option>
            ))}
          </select>
          {lines.length > 0 && (
            <span className="mt-1 block text-xs text-slate-500">
              เปลี่ยนใบสั่งขายไม่ได้แล้ว — ล้างรายการก่อนถ้าต้องการเปลี่ยน
            </span>
          )}
        </label>

        {!so && warehouses.length > 1 && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              จ่ายจากคลัง
            </span>
            <select
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setLines([]);
                setLotsByProduct({});
              }}
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

        {so && (
          <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">
            ส่งตาม {so.docNo} · {so.partner.name} — ยิงได้เฉพาะของในใบนี้
            และไม่เกินยอดค้างส่ง
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
                mode="out"
                lots={lotsByProduct[line.productId]}
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
        mode="out"
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
