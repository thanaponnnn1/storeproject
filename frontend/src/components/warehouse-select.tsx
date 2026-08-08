'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useUrlFilters } from '@/components/list';
import type { Warehouse } from '@/lib/types';

/**
 * เลือกคลัง — เก็บไว้ใน URL เหมือนตัวกรองอื่น
 * ร้านที่มีคลังเดียวจะไม่เห็นตัวเลือกนี้เลย (ไม่รกหน้าจอโดยไม่จำเป็น)
 */
export function WarehouseSelect({
  onReady,
}: {
  onReady?: (warehouseId: string) => void;
}) {
  const { params, setFilter } = useUrlFilters();
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const selected = params.get('warehouseId') ?? '';

  useEffect(() => {
    void api<Warehouse[]>('warehouses')
      .then((list) => {
        setWarehouses(list);
        if (!selected && list[0]) onReady?.(list[0].id);
      })
      .catch(() => setWarehouses([]));
    // ตั้งใจให้รันครั้งเดียวตอนเปิดหน้า
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!warehouses || warehouses.length <= 1) return null;

  return (
    <select
      value={selected}
      onChange={(e) => setFilter({ warehouseId: e.target.value })}
      aria-label="เลือกคลัง"
      className="tap-target rounded-lg border border-slate-300 bg-white px-3"
    >
      <option value="">ทุกคลัง</option>
      {warehouses.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
