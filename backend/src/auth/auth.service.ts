import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { RoleName } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload, AuthTokens } from './auth.types';

@Injectable()
export class AuthService {
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = config.getOrThrow<number>('REFRESH_TTL_DAYS');
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
    // ตรวจ hash เสมอแม้ไม่พบ user — กัน timing attack เดา email ที่มีในระบบ
    const hashToVerify =
      user?.passwordHash ??
      '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordOk = await argon2
      .verify(hashToVerify, password)
      .catch(() => false);

    if (!user || !user.isActive || !passwordOk) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    return this.issueTokens(
      { sub: user.id, email: user.email, role: user.role.name as RoleName },
      randomUUID(), // family ใหม่ต่อการ login หนึ่งครั้ง
    );
  }

  /**
   * Rotation: refresh หนึ่งครั้ง = revoke token เดิม + ออกคู่ใหม่ใน family เดิม
   * ถ้า token ที่ถูก revoke แล้วถูกส่งมาอีก (reuse) = ถูกขโมย → revoke ทั้ง family
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { role: true } } },
    });

    if (!stored) throw new UnauthorizedException('Refresh token ไม่ถูกต้อง');

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'ตรวจพบการใช้ refresh token ซ้ำ — ยกเลิก session ทั้งหมดแล้ว กรุณา login ใหม่',
      );
    }

    if (stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Refresh token หมดอายุ');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      {
        sub: stored.user.id,
        email: stored.user.email,
        role: stored.user.role.name as RoleName,
      },
      stored.familyId,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (!stored) return; // logout เป็น idempotent — ไม่บอกใบ้ว่า token ไหนมีจริง
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    payload: AccessTokenPayload,
    familyId: string,
  ): Promise<AuthTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt,
      },
    });

    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
