import type { RoleName } from '../common/decorators/roles.decorator';

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  email: string;
  role: RoleName;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

declare module 'express' {
  interface Request {
    user?: AccessTokenPayload;
  }
}
