import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, getAccessToken, refreshTokens } from '@/lib/auth';

/**
 * ทางผ่านเดียวที่หน้าเว็บใช้คุยกับ backend
 *
 * ทำไมต้องมี: token อยู่ใน httpOnly cookie ซึ่ง JavaScript อ่านไม่ได้
 * ที่นี่ (ฝั่ง server) จึงเป็นคนแนบ token ให้ และถ้า access token หมดอายุ
 * ก็ขอใหม่ด้วย refresh token แล้วยิงซ้ำให้อัตโนมัติ — ผู้ใช้ไม่ต้อง login ใหม่
 */
async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const search = req.nextUrl.search;
  const url = `${BACKEND_URL}/${path.join('/')}${search}`;

  // อ่าน body ครั้งเดียวเก็บไว้ เพราะอาจต้องยิงซ้ำหลัง refresh
  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : await req.text();

  const forward = (token?: string) =>
    fetch(url, {
      method: req.method,
      headers: {
        'content-type': req.headers.get('content-type') ?? 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      cache: 'no-store',
    });

  let token = await getAccessToken();
  let res = await forward(token);

  if (res.status === 401) {
    const fresh = await refreshTokens();
    if (fresh) {
      token = fresh;
      res = await forward(fresh);
    }
  }

  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
