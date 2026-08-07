import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * แปลง Prisma error เป็น HTTP exception ที่สื่อความหมาย
 * P2002 = unique ซ้ำ → 409, P2025 = ไม่พบ record → 404, P2003 = FK ไม่ถูก → 409
 */
export function rethrowPrismaError(e: unknown, entity: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      const fields = (e.meta?.target as string[] | undefined)?.join(', ');
      throw new ConflictException(
        `${entity} ซ้ำ: ${fields ?? 'ค่าที่ต้อง unique'} มีอยู่แล้วในระบบ`,
      );
    }
    if (e.code === 'P2025') {
      throw new NotFoundException(`ไม่พบ ${entity}`);
    }
    if (e.code === 'P2003') {
      throw new ConflictException(
        `${entity} อ้างถึงข้อมูลที่ไม่มีอยู่ (foreign key ไม่ถูกต้อง)`,
      );
    }
  }
  throw e;
}
