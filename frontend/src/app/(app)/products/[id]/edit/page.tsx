'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { BackLink } from '@/components/back-link';
import { ErrorState, Loading } from '@/components/ui';
import { ProductForm } from '@/components/product-form';
import type { Product } from '@/lib/types';

export default function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Product>(`products/${id}`)
      .then(setProduct)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'),
      );
  }, [id]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!product) return <Loading />;

  return (
    <div className="space-y-4">
      <BackLink href={`/products/${id}`} label="กลับไปหน้าสินค้า" />
      <h1 className="mx-auto max-w-2xl text-xl font-bold">
        แก้ไข {product.name}
      </h1>
      <ProductForm product={product} />
    </div>
  );
}
