'use client';

import { Button } from '@/components/ui';

/** จอพังทั้งหน้า — ต้องมีทางออกเสมอ ไม่ใช่จอขาว */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <h1 className="text-lg font-bold text-red-900">เกิดข้อผิดพลาด</h1>
        <p className="text-sm text-red-800">{error.message}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={reset}>ลองใหม่</Button>
          <Button
            variant="secondary"
            onClick={() => (window.location.href = '/')}
          >
            กลับหน้าหลัก
          </Button>
        </div>
      </div>
    </main>
  );
}
