import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

/** field ที่ห้ามเก็บลง audit log เด็ดขาด */
const REDACTED_FIELDS = new Set([
  'password',
  'newPassword',
  'refreshToken',
  'accessToken',
  'token',
  'apiSecret',
  'signature',
]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    // อ่านอย่างเดียวไม่ต้องบันทึก — audit สนใจแค่การเปลี่ยนแปลงข้อมูล
    if (request.method === 'GET' || request.method === 'OPTIONS') {
      return next.handle();
    }

    const startedAt = Date.now();
    return next.handle().pipe(
      tap({
        next: () => void this.record(context, request, startedAt),
        error: () => void this.record(context, request, startedAt),
      }),
    );
  }

  private async record(
    context: ExecutionContext,
    request: Request,
    startedAt: number,
  ): Promise<void> {
    try {
      const response = context.switchToHttp().getResponse<Response>();
      const user = request.user;
      const path = request.originalUrl ?? request.url;

      await this.prisma.auditLog.create({
        data: {
          userId: user?.sub,
          userEmail: user?.email,
          userRole: user?.role,
          action: this.deriveAction(request),
          entityType: this.deriveEntityType(path),
          entityId: (request.params as Record<string, string>)?.id ?? null,
          method: request.method,
          path,
          statusCode: response.statusCode,
          payload: this.redact(request.body) as object,
          ip: request.ip ?? null,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch {
      // audit ต้องไม่ทำให้ธุรกรรมหลักพัง — บันทึกไม่ได้ก็ปล่อยผ่าน
    }
  }

  /** quotations.approve จาก PATCH /api/quotations/:id/approve */
  private deriveAction(request: Request): string {
    const segments = (request.route?.path ?? request.path)
      .split('/')
      .filter((s: string) => s && s !== 'api' && !s.startsWith(':'));
    const entity = segments[0] ?? 'unknown';
    const verb =
      segments.length > 1
        ? segments[segments.length - 1]
        : request.method === 'POST'
          ? 'create'
          : request.method === 'DELETE'
            ? 'delete'
            : 'update';
    return `${entity}.${verb}`;
  }

  private deriveEntityType(path: string): string {
    return path.split('/').filter(Boolean)[1] ?? 'unknown';
  }

  private redact(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body ?? null;
    if (Array.isArray(body)) return body.map((item) => this.redact(item));

    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      output[key] = REDACTED_FIELDS.has(key)
        ? '[REDACTED]'
        : typeof value === 'object'
          ? this.redact(value)
          : value;
    }
    return output;
  }
}
