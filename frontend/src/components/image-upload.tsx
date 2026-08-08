'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button } from '@/components/ui';
import type { UploadSignature } from '@/lib/types';

/**
 * อัปโหลดรูปตรงไป Cloudinary — ไฟล์ไม่วิ่งผ่านเซิร์ฟเวอร์เรา
 * ขอลายเซ็นจาก backend ก่อน แล้วยิงไฟล์ตรงไป Cloudinary
 */
export function ImageUpload({
  value,
  previewUrl,
  onChange,
}: {
  value: string | null;
  previewUrl?: string | null;
  onChange: (publicId: string | null, url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(previewUrl ?? null);

  async function upload(file: File) {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('ไฟล์ต้องเป็นรูปภาพเท่านั้น');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('ไฟล์ใหญ่เกิน 10 MB — ถ่ายใหม่หรือย่อรูปก่อน');
      return;
    }

    setUploading(true);
    try {
      const sig = await api<UploadSignature>('uploads/signature', {
        method: 'POST',
        body: { folder: 'products' },
      });

      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.apiKey);
      form.append('timestamp', String(sig.timestamp));
      form.append('folder', sig.folder);
      form.append('signature', sig.signature);

      const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(detail?.error?.message ?? 'อัปโหลดรูปไม่สำเร็จ');
      }

      const data = (await res.json()) as {
        public_id: string;
        secure_url: string;
      };
      setPreview(data.secure_url);
      onChange(data.public_id, data.secure_url);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'อัปโหลดรูปไม่สำเร็จ — ลองใหม่อีกครั้ง',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-slate-700">รูปสินค้า</span>

      <div className="flex items-center gap-3">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
          {preview ? (
            // ใช้ img ธรรมดาเพราะ URL มาจาก Cloudinary ที่ย่อขนาดมาแล้ว
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="รูปสินค้า"
              className="size-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-3xl text-slate-300">
              📷
            </span>
          )}
        </div>

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="secondary"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {value ? 'เปลี่ยนรูป' : 'เลือก / ถ่ายรูป'}
          </Button>
          {value && (
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                onChange(null, null);
              }}
              className="block text-sm text-red-600 hover:underline"
            >
              เอารูปออก
            </button>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
    </div>
  );
}
