import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, setAuthCookies, type Tokens } from '@/lib/auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { email?: string; password?: string };

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    return NextResponse.json(
      { message: error?.message ?? 'เข้าสู่ระบบไม่สำเร็จ' },
      { status: res.status },
    );
  }

  await setAuthCookies((await res.json()) as Tokens);
  return NextResponse.json({ ok: true });
}
