import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** เปิด endpoint ให้เข้าได้โดยไม่ต้องมี access token (default ทั้งแอปคือต้อง login) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
