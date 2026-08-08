'use client';

import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input } from '@/components/ui';

/**
 * จำกัดรูปแบบที่อ่าน — ยิ่งน้อยยิ่งอ่านเร็ว
 * EAN-13/8 = สินค้าทั่วไป, Code128/39 = ฉลากโรงงาน, QR = สติกเกอร์ที่ร้านพิมพ์เอง
 */
const HINTS = new Map([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.ITF,
      BarcodeFormat.UPC_A,
    ],
  ],
]);

/** เสียงติ๊ดสั้น ๆ ตอนยิงติด — หน้างานจะได้ไม่ต้องจ้องจอ */
function beep() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1800;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    setTimeout(() => void ctx.close(), 300);
  } catch {
    // เล่นเสียงไม่ได้ก็ไม่เป็นไร ไม่ควรทำให้การสแกนพัง
  }
  navigator.vibrate?.(60);
}

type CameraState = 'idle' | 'starting' | 'running' | 'error';

export function BarcodeScanner({
  onScan,
}: {
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState('');

  const handleResult = useCallback(
    (code: string) => {
      const now = Date.now();
      // กันยิงซ้ำรัว ๆ ตัวเดิม แต่ยังยิงซ้ำได้ถ้าตั้งใจ (นับของทีละชิ้น)
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.at < 1500
      ) {
        return;
      }
      lastScanRef.current = { code, at: now };
      beep();
      onScan(code);
    },
    [onScan],
  );

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setTorchOn(false);
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState('starting');

    // iOS เปิดกล้องให้เฉพาะ HTTPS — บอกวิธีแก้ให้ชัดแทนที่จะขึ้น error งง ๆ
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError(
        window.isSecureContext
          ? 'เบราว์เซอร์นี้ไม่รองรับการใช้กล้อง — ลองใช้ Safari หรือ Chrome รุ่นใหม่'
          : 'ต้องเปิดผ่าน https:// เท่านั้น iPhone ถึงจะยอมให้ใช้กล้อง (ดูวิธีรันแบบ https ที่ README) — ระหว่างนี้พิมพ์รหัสด้วยมือได้',
      );
      return;
    }

    try {
      const reader = new BrowserMultiFormatReader(HINTS);
      controlsRef.current = await reader.decodeFromConstraints(
        // กล้องหลัง + ความละเอียดพอให้อ่านบาร์โค้ดเล็ก ๆ ได้
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current!,
        (result) => {
          if (result) handleResult(result.getText());
        },
      );
      setState('running');
    } catch (e) {
      setState('error');
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้เว็บนี้ในตั้งค่าเบราว์เซอร์ แล้วกดเริ่มใหม่'
          : name === 'NotFoundError'
            ? 'ไม่พบกล้องบนเครื่องนี้ — พิมพ์รหัสด้วยมือแทนได้'
            : 'เปิดกล้องไม่สำเร็จ — ลองปิดแอปอื่นที่ใช้กล้องอยู่ แล้วกดเริ่มใหม่',
      );
    }
  }, [handleResult]);

  // ปิดกล้องเมื่อออกจากหน้า ไม่งั้นไฟกล้องค้างและกินแบต
  useEffect(() => () => controlsRef.current?.stop(), []);

  /** ไฟฉาย — จำเป็นมากในคลังที่แสงน้อย (บางเครื่อง/บางเบราว์เซอร์ไม่รองรับ) */
  async function toggleTorch() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn((v) => !v);
    } catch {
      setError('เครื่องนี้เปิดไฟฉายจากเว็บไม่ได้ — เปิดไฟในห้องช่วยแทน');
    }
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    setManual('');
    onScan(code);
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-slate-900">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`aspect-[4/3] w-full object-cover ${state === 'running' ? '' : 'opacity-0'}`}
        />

        {state === 'running' && (
          <>
            {/* กรอบเล็งให้รู้ว่าต้องเอาบาร์โค้ดมาไว้ตรงไหน */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-1/2 h-28 -translate-y-1/2 rounded-lg border-2 border-white/80"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3">
              <button
                onClick={toggleTorch}
                className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white"
              >
                {torchOn ? '🔦 ปิดไฟ' : '🔦 เปิดไฟ'}
              </button>
              <button
                onClick={stop}
                className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white"
              >
                หยุดกล้อง
              </button>
            </div>
          </>
        )}

        {state !== 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span aria-hidden className="text-5xl">
              📷
            </span>
            <p className="text-sm text-slate-300">
              {state === 'starting'
                ? 'กำลังเปิดกล้อง…'
                : 'เล็งบาร์โค้ดให้อยู่ในกรอบ ระบบจะอ่านให้เอง'}
            </p>
            <Button onClick={start} loading={state === 'starting'}>
              เริ่มสแกน
            </Button>
          </div>
        )}
      </div>

      {error && <Alert tone="warning">{error}</Alert>}

      {/* ทางสำรองที่ต้องมีเสมอ: บาร์โค้ดขาด/เลอะ หรือกล้องพัง ก็ยังทำงานต่อได้ */}
      <form onSubmit={submitManual} className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="หรือพิมพ์รหัส/serial ด้วยมือ"
          aria-label="พิมพ์รหัสบาร์โค้ดหรือ serial ด้วยมือ"
          enterKeyHint="search"
        />
        <Button type="submit" variant="secondary" disabled={!manual.trim()}>
          ค้นหา
        </Button>
      </form>
    </div>
  );
}
