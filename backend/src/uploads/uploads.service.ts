import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
  uploadUrl: string;
}

/**
 * รูปสินค้าเก็บที่ Cloudinary — ไฟล์ไม่วิ่งผ่าน NestJS เลย
 *
 * หน้าบ้านขอลายเซ็นจากที่นี่ แล้วอัปโหลดตรงไป Cloudinary
 * API secret จึงไม่มีวันหลุดไปฝั่ง client และเซิร์ฟเวอร์เราไม่ต้องแบกไฟล์
 */
@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {}

  createSignature(folder = 'products'): UploadSignature {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'ยังไม่ได้ตั้งค่า Cloudinary — ใส่ CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET ใน .env',
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    // Cloudinary: เรียง key ตามตัวอักษร ต่อเป็น query string แล้ว sha1 กับ api_secret
    const toSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
      .update(toSign + apiSecret)
      .digest('hex');

    return {
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    };
  }

  /** สร้าง URL รูปพร้อม transformation (thumbnail ให้หน้าเว็บโหลดเร็ว) */
  imageUrl(publicId: string | null, transformation = 'f_auto,q_auto,w_400') {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    if (!publicId || !cloudName) return null;
    return `https://res.cloudinary.com/${cloudName}/image/upload/${transformation}/${publicId}`;
  }
}
