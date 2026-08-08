import { Injectable } from '@nestjs/common';
import type { Tx } from '../../inventory/costing/costing.types';

export type DocType = 'QT' | 'SO' | 'DO' | 'INV' | 'PMT' | 'PO' | 'GR';

@Injectable()
export class DocNumberService {
  /**
   * ออกเลขรันเอกสารรูปแบบ QT-2026-08-0001
   *
   * ต้องเรียกภายใน transaction เดียวกับการสร้างเอกสาร และ lock แถวตัวนับด้วย
   * FOR UPDATE — ไม่งั้นสองคนกดสร้างพร้อมกันจะได้เลขซ้ำ (แล้วชน unique ทีหลัง
   * หรือแย่กว่านั้นคือเลขโดดเป็นช่วง ซึ่งสรรพากรถามหา)
   */
  async next(tx: Tx, docType: DocType, date = new Date()): Promise<string> {
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    await tx.$executeRaw`
      INSERT INTO document_counters (doc_type, period, last_no)
      VALUES (${docType}, ${period}, 0)
      ON CONFLICT (doc_type, period) DO NOTHING`;

    const rows = await tx.$queryRaw<{ last_no: number }[]>`
      SELECT last_no FROM document_counters
      WHERE doc_type = ${docType} AND period = ${period}
      FOR UPDATE`;

    const nextNo = (rows[0]?.last_no ?? 0) + 1;
    await tx.documentCounter.update({
      where: { docType_period: { docType, period } },
      data: { lastNo: nextNo },
    });

    return `${docType}-${period}-${String(nextNo).padStart(4, '0')}`;
  }
}
