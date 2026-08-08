'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type Paginated } from '@/lib/api';
import { Button, ErrorState, Loading } from '@/components/ui';

/**
 * อ่าน/เขียนค่าตัวกรองผ่าน URL
 *
 * เก็บสถานะไว้ที่ URL ทั้งหมด → กดถอย/รีเฟรช/ส่งลิงก์ให้เพื่อน ได้ผลเหมือนเดิมเสมอ
 * ใช้ replace ไม่ใช่ push เพราะพิมพ์ค้นหาทีละตัวอักษรไม่ควรกลายเป็นประวัติ 10 หน้า
 */
export function useUrlFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const setFilter = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      // แก้ตัวกรองแล้วต้องกลับหน้าแรกเสมอ ไม่งั้นค้างอยู่หน้า 5 ที่ไม่มีข้อมูล
      if (!('page' in updates)) next.delete('page');
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return { params, setFilter };
}

/** ช่องค้นหา — หน่วงไว้ 350ms กันยิง API ทุกตัวอักษร */
export function SearchInput({
  placeholder = 'ค้นหา…',
}: {
  placeholder?: string;
}) {
  const { params, setFilter } = useUrlFilters();
  const urlValue = params.get('search') ?? '';
  const [value, setValue] = useState(urlValue);
  const first = useRef(true);

  // กดถอยแล้วช่องค้นหาต้องเปลี่ยนตาม URL ด้วย
  useEffect(() => setValue(urlValue), [urlValue]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (value === urlValue) return;
    const timer = setTimeout(() => setFilter({ search: value }), 350);
    return () => clearTimeout(timer);
  }, [value, urlValue, setFilter]);

  return (
    <div className="relative">
      <input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="tap-target w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 outline-none focus:border-slate-900"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      >
        🔍
      </span>
    </div>
  );
}

export function FilterTabs({
  name,
  options,
}: {
  name: string;
  options: { value: string; label: string }[];
}) {
  const { params, setFilter } = useUrlFilters();
  const current = params.get(name) ?? '';

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => setFilter({ [name]: opt.value })}
            aria-pressed={active}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm ${
              active
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
}: {
  page: number;
  totalPages: number;
  total: number;
}) {
  const { setFilter } = useUrlFilters();
  if (totalPages <= 1) {
    return <p className="text-center text-sm text-slate-500">ทั้งหมด {total} รายการ</p>;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => setFilter({ page: page - 1 })}
      >
        ← ก่อนหน้า
      </Button>
      <span className="text-sm text-slate-600">
        หน้า {page} / {totalPages}
        <span className="hidden sm:inline"> · ทั้งหมด {total} รายการ</span>
      </span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => setFilter({ page: page + 1 })}
      >
        ถัดไป →
      </Button>
    </div>
  );
}

interface ListResult<T> {
  items: T[];
  meta: Paginated<T>['meta'] | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** ดึงข้อมูลรายการตามตัวกรองใน URL — จัดการสถานะโหลด/พังให้ครบ */
export function useList<T>(path: string, query: string): ListResult<T> {
  const [state, setState] = useState<{
    items: T[];
    meta: Paginated<T>['meta'] | null;
    loading: boolean;
    error: string | null;
  }>({ items: [], meta: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    api<Paginated<T>>(`${path}?${query}`, { signal: controller.signal })
      .then((res) =>
        setState({
          items: res.data,
          meta: res.meta,
          loading: false,
          error: null,
        }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          items: [],
          meta: null,
          loading: false,
          error:
            err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ',
        });
      });

    return () => controller.abort();
  }, [path, query, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** ห่อรายการให้แสดงสถานะครบ: โหลด → พัง → ว่าง → ข้อมูล */
export function ListState({
  loading,
  error,
  isEmpty,
  emptyLabel,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyLabel: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-600">
        {emptyLabel}
      </div>
    );
  }
  return <>{children}</>;
}
