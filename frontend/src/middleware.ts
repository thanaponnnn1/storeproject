import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth';

/**
 * ยังไม่ login แล้วเข้าหน้าลึก ๆ → เด้งไป /login พร้อมจำหน้าเดิมไว้ใน ?next=
 * เพื่อพากลับมาที่เดิมหลัง login (ไม่ใช่โยนไปหน้าแรกให้หาใหม่)
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const hasSession =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);

  if (pathname === '/login') {
    if (hasSession) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  // ส่ง path ปัจจุบันให้ layout รู้ (ใช้พากลับมาที่เดิมหลังต่ออายุ token)
  const headers = new Headers(req.headers);
  headers.set('x-current-path', pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // ยกเว้นไฟล์ static และ route handler ของ auth เอง
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest.json).*)'],
};
