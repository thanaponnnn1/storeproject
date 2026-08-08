'use client';

import Link from 'next/link';

/** ปุ่มหลัก — สูงพอกดด้วยนิ้วโป้ง มีสถานะกำลังทำงานให้เห็นชัด */
export function Button({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
}) {
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400',
    secondary:
      'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  }[variant];

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-lg px-5 text-base font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`tap-target w-full rounded-lg border border-slate-300 bg-white px-3 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 ${props.className ?? ''}`}
    />
  );
}

/** กล่องแจ้งเตือน — ใช้แสดง error จาก API ตรง ๆ ไม่กลบด้วยข้อความกลาง ๆ */
export function Alert({
  children,
  tone = 'error',
}: {
  children: React.ReactNode;
  tone?: 'error' | 'warning' | 'info';
}) {
  const styles = {
    error: 'bg-red-50 text-red-800 border-red-200',
    warning: 'bg-amber-50 text-amber-900 border-amber-200',
    info: 'bg-sky-50 text-sky-900 border-sky-200',
  }[tone];
  return (
    <div
      role="alert"
      className={`rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

/** สถานะกำลังโหลด — ไม่ปล่อยจอขาว */
export function Loading({ label = 'กำลังโหลด…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      {label}
    </div>
  );
}

/** สถานะว่างเปล่า — บอกด้วยว่าทำอะไรต่อได้ */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="tap-target mt-4 inline-flex items-center rounded-lg bg-slate-900 px-5 text-white"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** สถานะพัง — ต้องมีปุ่มลองใหม่เสมอ ไม่ใช่ทางตัน */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center">
      <p className="font-medium text-red-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          ลองใหม่
        </Button>
      )}
    </div>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}
    >
      {children}
    </div>
  );
}
