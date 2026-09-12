export type Role = "admin" | "employee";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export interface PurchaseBatch {
  id: string;
  label: string;
  source: "excel" | "manual";
  total_detected: number;
  total_ok: number;
  total_errors: number;
  original_data: unknown;
  created_by: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  cost: number;
  price: number;
  stock_physical: number;
  stock_reserved: number;
  stock_available: number;
  batch_id: string | null;
  active: boolean;
  image_url: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  status: string;
  deleted_at: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: number;
  customer_id: string;
  status: "open" | "closed" | "reopened" | "cancelled";
  opened_at: string;
  closed_at: string | null;
  created_by: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  origin: string;
  assigned_by: string | null;
  assigned_at: string;
}

export interface Payment {
  id: string;
  customer_id: string;
  order_id: string | null;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  registered_by: string | null;
  paid_at: string;
}

export interface CatalogProduct {
  id: string;
  product_id: string | null;
  code: string;
  name: string;
  price: number;
  image_url: string | null;
  stock_available: number;
  active: boolean;
  created_at: string;
}

export interface AppSettings {
  id: number;
  business_name: string;
  whatsapp_number: string | null;
  theme_preset: string;
  color_primario: string;
  color_acento: string;
  estilo_barra: string;
  updated_at: string;
}

export interface CatalogSubmission {
  id: string;
  code: string;
  customer_name: string;
  customer_phone: string;
  status: "pending" | "reviewed" | "attached" | "discarded";
  session_id: string | null;
  order_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface CatalogSubmissionItem {
  id: string;
  submission_id: string;
  catalog_product_id: string;
  quantity: number;
}
