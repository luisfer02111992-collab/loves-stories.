export type Role = "admin" | "employee";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
  permissions?: string[] | null;
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
  deleted_at: string | null;
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
  customer_id: string | null;
  status: "open" | "closed" | "reopened" | "cancelled";
  opened_at: string;
  closed_at: string | null;
  total_cerrado: number | null;
  total_original: number | null;
  direct_sale: boolean;
  direct_sale_name: string | null;
  created_by: string | null;
}

export interface Seller {
  id: string;
  name: string;
  active: boolean;
  commission_type: "none" | "percentage" | "fixed";
  commission_value: number;
  linked_profile_id: string | null;
  created_at: string;
}

export interface SalesSession {
  id: string;
  seller_id: string;
  started_at: string;
  ended_at: string | null;
  started_by: string | null;
  notes: string | null;
}

export interface Devolucion {
  id: string;
  order_id: string;
  customer_id: string;
  type: "producto" | "correccion";
  total_amount: number;
  reason: string | null;
  observation: string | null;
  status: "activa" | "anulada";
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface DevolucionItem {
  id: string;
  return_id: string;
  product_id: string | null;
  order_item_id: string | null;
  quantity: number;
  amount: number;
  reason: string;
  restock: boolean;
  observation: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  origin: string;
  seller_id: string | null;
  session_id: string | null;
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
