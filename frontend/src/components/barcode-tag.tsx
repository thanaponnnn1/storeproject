'use client';

import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';

/**
 * สติกเกอร์ QR สำหรับสินค้าที่ไม่มีบาร์โค้ดโรงงาน (เหล็กเส้น ท่อ ปูน)
 * พิมพ์ไปแปะชั้นวาง แล้วยิงด้วยมือถือได้เหมือนบาร์โค้ดปกติ
 */
export function BarcodeTag({
  code,
  productName,
  sku,
  unitName,
}: {
  code: string;
  productName: string;
  sku: string;
  unitName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, code, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
  }, [open, code]);

  return (
    <div className="print:block">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          แสดง QR สำหรับพิมพ์
        </Button>
      ) : (
        <div className="space-y-3">
          {/* กรอบนี้คือสิ่งที่จะถูกพิมพ์ — ข้อมูลครบพอให้คนอ่านออกโดยไม่ต้องยิง */}
          <div
            id="print-tag"
            className="mx-auto w-fit rounded-lg border border-slate-300 bg-white p-4 text-center"
          >
            <canvas ref={canvasRef} />
            <p className="mt-2 font-medium">{productName}</p>
            <p className="text-sm text-slate-600">
              {sku} · หน่วย {unitName}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-400">{code}</p>
          </div>

          <div className="flex justify-center gap-2">
            <Button onClick={() => window.print()}>🖨️ พิมพ์</Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              ปิด
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
