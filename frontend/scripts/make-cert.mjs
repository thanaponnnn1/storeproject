// สร้างใบรับรอง https สำหรับเปิดเว็บจากมือถือในวง WiFi เดียวกัน
// (iOS ไม่ยอมให้เว็บใช้กล้องถ้าไม่ใช่ https)
//
// ใบรับรองต้องครอบคลุม IP ของคอมเครื่องนี้ด้วย ไม่ใช่แค่ localhost
// สคริปต์นี้จึงหา IP ให้อัตโนมัติ แล้วเรียก mkcert สร้างใบใหม่
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces, homedir } from 'node:os';
import { join } from 'node:path';

const MKCERT = join(
  homedir(),
  'AppData',
  'Local',
  'mkcert',
  'mkcert-v1.4.4-windows-amd64.exe',
);

function lanIps() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(
      (n) =>
        n &&
        n.family === 'IPv4' &&
        !n.internal &&
        // ข้าม virtual adapter ของ WSL/Docker ที่มือถือต่อไม่ได้
        !n.address.startsWith('172.'),
    )
    .map((n) => n.address);
}

const ips = lanIps();
if (!existsSync(MKCERT)) {
  console.error(
    'ไม่พบ mkcert — รัน `pnpm dev:https` หนึ่งครั้งก่อน Next.js จะดาวน์โหลดให้เอง',
  );
  process.exit(1);
}

mkdirSync('certificates', { recursive: true });
execFileSync(
  MKCERT,
  [
    '-key-file',
    'certificates/localhost-key.pem',
    '-cert-file',
    'certificates/localhost.pem',
    'localhost',
    '127.0.0.1',
    '::1',
    ...ips,
  ],
  { stdio: 'inherit' },
);

console.log('\nเปิดจากมือถือได้ที่:');
for (const ip of ips) console.log(`  https://${ip}:3001`);
console.log('\n(Safari จะเตือนเรื่องใบรับรอง กด "เข้าชมเว็บไซต์นี้" ได้เลย)');
