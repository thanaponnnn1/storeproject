'use client';

/** ข้อความ error จาก backend เป็นภาษาไทยอยู่แล้ว — เอามาแสดงตรง ๆ */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * เรียก backend ผ่าน proxy ฝั่ง Next (ที่แนบ token ให้เอง)
 * path ใส่แบบไม่มี /api นำหน้า เช่น api('products?limit=20')
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (res.status === 401) {
    // session หมดจริง ๆ (proxy ลอง refresh ให้แล้วไม่ผ่าน)
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError('หมดเวลาใช้งาน กรุณาเข้าสู่ระบบใหม่', 401);
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message = (data as { message?: string | string[] } | null)?.message;
    throw new ApiError(
      Array.isArray(message)
        ? message.join(', ')
        : (message ?? `เกิดข้อผิดพลาด (${res.status})`),
      res.status,
    );
  }
  return data as T;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
