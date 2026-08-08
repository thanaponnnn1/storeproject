'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Field, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // พากลับไปหน้าที่ตั้งใจจะเข้าตอนแรก ไม่ใช่โยนไปหน้าแรกให้หาใหม่
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        setError(data.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('ต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่า backend เปิดอยู่ไหม');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert>{error}</Alert>}

      <Field label="อีเมล">
        <Input
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@store.local"
        />
      </Field>

      <Field label="รหัสผ่าน">
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button type="submit" loading={loading} className="w-full">
        เข้าสู่ระบบ
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold">ระบบคลังสินค้า</h1>
          <p className="mt-1 text-sm text-slate-500">
            เครื่องใช้ไฟฟ้า · อุปกรณ์ช่าง · วัสดุก่อสร้าง
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <Suspense fallback={<div className="h-64" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
