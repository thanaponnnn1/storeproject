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

/**
 * ยิงต่อเนื่อง = เจออะไรอ่านเลย เร็วดีตอนยิงของทีละชิ้น
 * กดแล้วยิง = เล็งให้ตรงก่อนแล้วค่อยกด กันอ่านผิดตัวเวลามีบาร์โค้ดหลายอันติดกัน
 *             (เช่นยิงจากแผ่นกระดาษที่พิมพ์ป้ายไว้หลายใบ)
 */
type ScanMode = 'continuous' | 'shutter';

export function BarcodeScanner({
  onScan,
}: {
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  /** โหมดกดแล้วยิง: รับผลได้เฉพาะตอนที่ผู้ใช้กดปุ่มแล้วเท่านั้น */
  const armedRef = useRef(false);
  const modeRef = useRef<ScanMode>('continuous');

  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState('');
  const [mode, setMode] = useState<ScanMode>('continuous');
  const [armed, setArmed] = useState(false);

  function changeMode(next: ScanMode) {
    modeRef.current = next;
    setMode(next);
    armedRef.current = false;
    setArmed(false);
  }

  const arm = useCallback(() => {
    armedRef.current = true;
    setArmed(true);
    // ปลดล็อกทิ้งถ้าอ่านไม่ได้ใน 4 วินาที จะได้ไม่ค้างสถานะรอ
    setTimeout(() => {
      armedRef.current = false;
      setArmed(false);
    }, 4000);
  }, []);

  const handleResult = useCallback(
    (code: string) => {
      // โหมดกดแล้วยิง: ยังไม่กดปุ่ม = ไม่รับผล
      if (modeRef.current === 'shutter') {
        if (!armedRef.current) return;
        armedRef.current = false;
        setArmed(false);
      } else {
        const now = Date.now();
        // กันยิงซ้ำรัว ๆ ตัวเดิม แต่ยังยิงซ้ำได้ถ้าตั้งใจ (นับของทีละชิ้น)
        if (
          lastScanRef.current.code === code &&
          now - lastScanRef.current.at < 1500
        ) {
          return;
        }
        lastScanRef.current = { code, at: now };
      }
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

  /**
   * ปุ่มยิงจากอุปกรณ์ภายนอก — ปุ่มชัตเตอร์ Bluetooth หรือแหวนสแกนที่ส่ง Enter/Space
   * (ปุ่มเพิ่ม/ลดเสียงของ iPhone ใช้ไม่ได้ — iOS ไม่ส่ง event ปุ่มเสียงให้เว็บ)
   */
  useEffect(() => {
    if (state !== 'running' || mode !== 'shutter') return;
    function onKey(e: KeyboardEvent) {
      // อย่าไปแย่งปุ่มตอนผู้ใช้กำลังพิมพ์ในช่องกรอก
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        arm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, mode, arm]);

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
            {/* กรอบเล็ง — โหมดกดแล้วยิงจะเปลี่ยนเป็นสีเขียวตอนกำลังรอรับผล */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-x-8 top-1/2 h-28 -translate-y-1/2 rounded-lg border-2 transition ${
                armed ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/80'
              }`}
            />

            {mode === 'shutter' && (
              <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-sm text-white drop-shadow">
                {armed ? 'กำลังอ่าน… ถือนิ่ง ๆ' : 'เล็งให้ตรงแล้วกดปุ่มยิง'}
              </p>
            )}

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-3">
              <button
                onClick={toggleTorch}
                className="rounded-lg bg-black/60 px-3 py-2 text-sm text-white"
              >
                {torchOn ? '🔦 ปิด' : '🔦 ไฟ'}
              </button>

              {mode === 'shutter' && (
                <button
                  onClick={arm}
                  aria-label="ยิงบาร์โค้ด"
                  className={`size-16 shrink-0 rounded-full border-4 border-white text-2xl transition active:scale-95 ${
                    armed ? 'bg-emerald-500' : 'bg-white/30'
                  }`}
                >
                  {armed ? '…' : '⦿'}
                </button>
              )}

              <button
                onClick={stop}
                className="rounded-lg bg-black/60 px-3 py-2 text-sm text-white"
              >
                หยุด
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

      {/* เลือกวิธียิง — ยิงจากแผ่นกระดาษที่มีหลายบาร์โค้ดควรใช้ "กดแล้วยิง" */}
      <div className="flex gap-2">
        {(
          [
            { value: 'continuous', label: '⚡ ยิงต่อเนื่อง' },
            { value: 'shutter', label: '🎯 กดแล้วยิง' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            onClick={() => changeMode(opt.value)}
            aria-pressed={mode === opt.value}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
              mode === opt.value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode === 'shutter' && state === 'running' && (
        <p className="text-center text-xs text-slate-500">
          กดปุ่มวงกลมบนกล้อง หรือปุ่มบนแหวนสแกน/ชัตเตอร์ Bluetooth ที่ส่ง Enter
        </p>
      )}

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
