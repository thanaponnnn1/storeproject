// สำรองฐานข้อมูลลงไฟล์ก่อนทำอะไรที่ย้อนกลับยาก
// รัน: node scripts/db-backup.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), '..', 'backups');
mkdirSync(dir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, '')
  .slice(0, 15);
const file = join(dir, `backup-${stamp}.sql`);

execSync(
  `docker exec storeproject-db pg_dump -U store -d storedb --clean --if-exists > "${file}"`,
  { shell: 'powershell.exe', stdio: 'inherit' },
);

const mb = (statSync(file).size / 1024 / 1024).toFixed(2);
console.log(`สำรองแล้ว: ${file} (${mb} MB)`);
console.log(
  `กู้คืน: docker exec -i storeproject-db psql -U store -d storedb < "${file}"`,
);
