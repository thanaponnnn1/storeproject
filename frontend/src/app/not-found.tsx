import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-lg font-bold">ไม่พบหน้านี้</h1>
        <p className="text-sm text-slate-600">
          ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว
        </p>
        <Link
          href="/"
          className="tap-target inline-flex items-center rounded-lg bg-slate-900 px-5 text-white"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </main>
  );
}
