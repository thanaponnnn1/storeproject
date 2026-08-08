import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'store_at';
export const REFRESH_COOKIE = 'store_rt';

export const BACKEND_URL =
  process.env.BACKEND_URL ?? 'http://localhost:3009/api';

/**
 * token เก็บใน httpOnly cookie ไม่ใช่ localStorage
 * — JavaScript ในหน้าเว็บอ่านไม่ได้ ต่อให้โดน XSS ก็ขโมย token ไม่ได้
 */
const cookieBase = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export async function setAuthCookies(tokens: Tokens): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase,
    maxAge: 60 * 20, // เผื่อจาก 15 นาทีนิดหน่อย
  });
  jar.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearAuthCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

/**
 * กันหลาย request ต่ออายุ token พร้อมกัน
 *
 * refresh token ใช้ได้ครั้งเดียว (rotation) ถ้าเปิดหน้าเว็บแล้วยิงหลาย request
 * พร้อมกันตอน token หมดอายุ ตัวที่สองจะใช้ token ที่เพิ่งถูก revoke ไป
 * ระบบหลังบ้านจะมองว่าโดนขโมย token แล้วเตะออกทั้งหมด — จึงต้องให้ทุกคน
 * รอผลของการต่ออายุครั้งเดียวกัน
 */
let pendingRefresh: Promise<string | null> | null = null;

/** ขอ token ชุดใหม่ด้วย refresh token — คืน access token ใหม่ หรือ null ถ้าหมดสิทธิ์แล้ว */
export async function refreshTokens(): Promise<string | null> {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    const jar = await cookies();
    const refreshToken = jar.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return null;

    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) {
      await clearAuthCookies();
      return null;
    }

    const tokens = (await res.json()) as Tokens;
    await setAuthCookies(tokens);
    return tokens.accessToken;
  })();

  try {
    return await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: { name: string };
}

/**
 * ข้อมูลผู้ใช้ปัจจุบัน — เรียกจาก server component ได้
 *
 * ที่นี่ต่ออายุ token เองไม่ได้ (Next ห้ามเซ็ต cookie ตอน render)
 * ถ้า token หมดอายุจะคืน 'expired' ให้ผู้เรียกเด้งไป /api/auth/touch แทน
 */
export async function getCurrentUser(): Promise<
  CurrentUser | 'expired' | null
> {
  const token = await getAccessToken();
  const jar = await cookies();
  const canRefresh = jar.has(REFRESH_COOKIE);

  if (!token) return canRefresh ? 'expired' : null;

  const res = await fetch(`${BACKEND_URL}/users/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 401) return canRefresh ? 'expired' : null;
  return res.ok ? ((await res.json()) as CurrentUser) : null;
}
