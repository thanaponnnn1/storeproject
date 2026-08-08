import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ระบบคลังสินค้า',
  description: 'คลังสินค้า + ซื้อ-ขาย เครื่องใช้ไฟฟ้า อุปกรณ์ช่าง วัสดุก่อสร้าง',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ไม่ล็อกซูม — ผู้ใช้สายตายาวต้องขยายอ่านได้
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
