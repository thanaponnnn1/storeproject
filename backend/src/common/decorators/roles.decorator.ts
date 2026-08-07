import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export type RoleName = 'ADMIN' | 'MANAGER' | 'WAREHOUSE' | 'SALES';

/** จำกัด endpoint ให้เฉพาะ role ที่ระบุ — ไม่ใส่ = ทุก role ที่ login แล้วเข้าได้ */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
