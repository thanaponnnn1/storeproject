'use client';

import { ProductForm } from '@/components/product-form';
import { BackLink } from '@/components/back-link';

export default function NewProductPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/products" label="กลับไปรายการสินค้า" />
      <h1 className="mx-auto max-w-2xl text-xl font-bold">เพิ่มสินค้าใหม่</h1>
      <ProductForm />
    </div>
  );
}
