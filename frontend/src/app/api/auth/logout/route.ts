import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  BACKEND_URL,
  REFRESH_COOKIE,
  clearAuthCookies,
} from '@/lib/auth';

export async function POST(): Promise<NextResponse> {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;

  // บอก backend ให้ revoke ทั้ง session family ด้วย ไม่ใช่แค่ลบ cookie ฝั่งเรา
  if (refreshToken) {
    await fetch(`${BACKEND_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => null);
  }

  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
