'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

/** หน้าที่ยังไม่ทำ — บอกตรง ๆ ว่าจะมาเฟสไหน และมีทางกลับเสมอ ไม่ใช่ทางตัน */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-lg space-y-4 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12">
        <p className="text-slate-600">หน้านี้กำลังพัฒนา</p>
        <p className="mt-1 text-sm text-slate-500">จะเสร็จใน {phase}</p>
      </div>
      <Button variant="secondary" onClick={() => router.back()}>
        ← ย้อนกลับ
      </Button>
    </div>
  );
}
