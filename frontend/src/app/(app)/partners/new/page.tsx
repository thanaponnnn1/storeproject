'use client';

import { BackLink } from '@/components/back-link';
import { PartnerForm } from '@/components/partner-form';

export default function NewPartnerPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/partners" label="กลับไปรายการคู่ค้า" />
      <h1 className="mx-auto max-w-2xl text-xl font-bold">
        เพิ่มลูกค้า / ซัพพลายเออร์
      </h1>
      <PartnerForm />
    </div>
  );
}
