'use client';

import { createContext, useContext } from 'react';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const UserContext = createContext<SessionUser | null>(null);

export function UserProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): SessionUser {
  const user = useContext(UserContext);
  if (!user) throw new Error('useUser ต้องอยู่ภายใน UserProvider');
  return user;
}

/** ซ่อนปุ่มที่ผู้ใช้กดไม่ได้ — ไม่ใช่การกันสิทธิ์ (ของจริงกันที่ backend) แค่ไม่ให้กดแล้วเจอ 403 */
export function useCan(roles: string[]): boolean {
  return roles.includes(useUser().role);
}
