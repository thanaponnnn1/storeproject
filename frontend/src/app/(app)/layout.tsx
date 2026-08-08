import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { BottomNav, LogoutButton, SideNav } from '@/components/nav';
import { UserProvider } from '@/components/user-context';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  MANAGER: 'ผู้จัดการ',
  WAREHOUSE: 'ฝ่ายคลัง',
  SALES: 'ฝ่ายขาย',
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (user === 'expired') {
    // token หมดอายุระหว่างใช้งาน → ต่ออายุที่ route handler แล้วกลับมาหน้าเดิม
    const h = await headers();
    const path = h.get('x-current-path') ?? '/';
    redirect(`/api/auth/touch?next=${encodeURIComponent(path)}`);
  }
  if (!user) redirect('/login');

  const role = user.role.name;

  return (
    <UserProvider
      user={{ id: user.id, name: user.name, email: user.email, role }}
    >
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <span className="font-bold">ระบบคลังสินค้า</span>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 sm:inline">
              {user.name} · {ROLE_LABEL[role] ?? role}
            </span>
            <LogoutButton />
          </div>
        </header>

        <div className="flex flex-1">
          <SideNav role={role} />
          {/* เว้นที่ล่างให้เมนูมือถือไม่ทับเนื้อหา */}
          <main className="flex-1 p-4 pb-24 lg:pb-6">{children}</main>
        </div>

        <BottomNav />
      </div>
    </UserProvider>
  );
}
