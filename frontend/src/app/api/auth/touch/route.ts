import { NextRequest, NextResponse } from 'next/server';
import { refreshTokens } from '@/lib/auth';

/**
 * ต่ออายุ session แล้วพากลับหน้าเดิม
 *
 * ทำไมต้องมีหน้านี้: Next.js ห้ามเซ็ต cookie ตอน render หน้า (server component)
 * เวลา access token หมดอายุระหว่างที่ผู้ใช้เปิดหน้าอยู่ จึงเด้งมาที่นี่
 * (เป็น route handler ซึ่งเซ็ต cookie ได้) ต่ออายุเสร็จแล้วส่งกลับไปที่เดิม
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  // กันคนหลอกให้เด้งไปเว็บนอก — รับเฉพาะ path ภายในเว็บเรา
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const token = await refreshTokens();
  return NextResponse.redirect(
    new URL(token ? safeNext : '/login', req.nextUrl.origin),
  );
}
