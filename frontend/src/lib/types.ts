export interface Uom {
  id: string;
  code: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
}

export interface ProductUnit {
  id: string;
  uomId: string;
  conversionFactor: string;
  salePrice: string | null;
  uom: Uom;
}

export interface ProductBarcode {
  id: string;
  barcode: string;
  isInternal: boolean;
  productUnitId: string | null;
  productUnit?: { uom: Uom } | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  categoryId: string | null;
  baseUomId: string;
  trackingType: 'NONE' | 'SERIAL' | 'LOT';
  costingMethod: 'AVG' | 'FIFO';
  warrantyMonths: number;
  priceRetail: string;
  priceContractor: string;
  priceProject: string;
  minStock: string;
  imagePublicId: string | null;
  imageUrl?: string | null;
  isActive: boolean;
  baseUom?: Uom;
  category?: Category | null;
  units?: ProductUnit[];
  barcodes?: ProductBarcode[];
}

export interface Partner {
  id: string;
  code: string;
  name: string;
  type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  taxId: string | null;
  phone: string | null;
  address: string | null;
  creditTermDays: number;
  priceLevel: 'RETAIL' | 'CONTRACTOR' | 'PROJECT';
  isActive: boolean;
}

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
  uploadUrl: string;
}
