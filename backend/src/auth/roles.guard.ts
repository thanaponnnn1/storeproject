import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ROLES_KEY,
  type RoleName,
} from '../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<Request>();
    // endpoint ที่เป็น @Public ไม่มี user — ถ้าประกาศ @Roles ด้วยถือว่า config ผิด ปิดไว้ก่อน
    if (!user) throw new ForbiddenException();

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `ต้องมีสิทธิ์: ${required.join(' หรือ ')}`,
      );
    }
    return true;
  }
}
