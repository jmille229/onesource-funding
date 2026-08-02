// ─── Enum types ───────────────────────────────────────────────────────────────

export type UserRole =
  | 'owner' | 'admin' | 'project_manager'
  | 'field_crew' | 'accountant' | 'viewer';

export type JobStatus =
  | 'lead' | 'bidding' | 'awarded' | 'active'
  | 'on_hold' | 'substantially_complete' | 'closed' | 'cancelled';

export type ContractType =
  | 'lump_sum' | 'gmp' | 'cost_plus_fixed'
  | 'cost_plus_pct' | 'time_and_materials' | 'unit_price';

export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type CostType = 'material' | 'labor' | 'subcontractor' | 'equipment' | 'overhead' | 'other';
export type ContactType = 'customer' | 'vendor' | 'subcontractor' | 'both';
export type ChangeOrderStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'void';
export type PurchaseOrderStatus = 'draft' | 'sent' | 'acknowledged' | 'partially_billed' | 'fully_billed' | 'closed';
export type BillStatus = 'draft' | 'pending_approval' | 'approved' | 'paid' | 'disputed';
export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'void';

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface Base {
  id: string;
  company_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;       // user_id
  cid: string;       // company_id
  role: UserRole;
  jti: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  abs: number;       // absolute session expiry
}

export interface AuthContext {
  userId: string;
  companyId: string;
  role: UserRole;
  jti: string;
}

// ─── Company & User ───────────────────────────────────────────────────────────

export interface CompanySettings {
  timezone: string;
  date_format: string;
  currency: string;
  default_markup_pct: number;
  default_retainage_pct: number;
  fiscal_year_start_month: number;
  invoice_prefix: string;
  po_prefix: string;
  co_prefix: string;
  pay_app_prefix: string;
}

export interface Company extends Base {
  name: string;
  slug: string;
  logo_url?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_code?: string | null;
  zip?: string | null;
  phone?: string | null;
  settings: CompanySettings;
  subscription_tier: 'starter' | 'professional' | 'gc_suite' | 'enterprise';
  subscription_status: 'trialing' | 'active' | 'past_due' | 'cancelled';
}

export interface User extends Base {
  email: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  role: UserRole;
  avatar_url?: string | null;
  phone?: string | null;
  job_title?: string | null;
  is_active: boolean;
  mfa_enabled: boolean;
  last_login_at?: string | null;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export interface Job extends Base {
  name: string;
  job_number: string;
  description?: string | null;
  status: JobStatus;
  contract_type: ContractType;
  contract_amount?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_code?: string | null;
  zip?: string | null;
  customer_id?: string | null;
  project_manager_id?: string | null;
  retainage_pct: number;
  prevailing_wage_required: boolean;
  // Computed joins
  customer_name?: string | null;
  project_manager_name?: string | null;
  total_budget?: number;
  total_price?: number;
  actual_cost?: number;
  committed_cost?: number;
  invoiced_amount?: number;
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export interface BudgetGroup extends Base {
  job_id: string;
  name: string;
  sort_order: number;
}

export interface BudgetItem extends Base {
  job_id: string;
  budget_id: string;
  budget_group_id?: string | null;
  name: string;
  description?: string | null;
  cost_type: CostType;
  cost_code?: string | null;
  unit?: string | null;
  quantity: number;
  unit_cost: number;
  markup_pct: number;
  ext_cost: number;
  unit_price: number;
  ext_price: number;
  sort_order: number;
  // Depletion
  committed?: number;
  actual?: number;
  invoiced?: number;
  labor?: number;
  depletion_pct?: number;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface TaskGroup extends Base {
  job_id: string;
  name: string;
  sort_order: number;
}

export interface Task extends Base {
  job_id: string;
  task_group_id?: string | null;
  name: string;
  description?: string | null;
  status: TaskStatus;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  completion_pct: number;
  budget_item_id?: string | null;
  sort_order: number;
  assignees?: { user_id: string; name: string }[];
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export interface Contact extends Base {
  name: string;
  type: ContactType;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_code?: string | null;
  zip?: string | null;
  license_number?: string | null;
  notes?: string | null;
}

// ─── Change Orders ────────────────────────────────────────────────────────────

export interface ChangeOrder extends Base {
  job_id: string;
  number: number;
  title: string;
  description?: string | null;
  status: ChangeOrderStatus;
  amount: number;
  cost_impact: number;
  time_impact_days: number;
  customer_id?: string | null;
  customer_name?: string | null;
}

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export interface PurchaseOrderItem {
  id: string;
  name: string;
  description?: string | null;
  quantity: number;
  unit: string;
  unit_cost: number;
  ext_cost: number;
  budget_item_id?: string | null;
}

export interface PurchaseOrder extends Base {
  job_id: string;
  number: string;
  status: PurchaseOrderStatus;
  vendor_id: string;
  vendor_name?: string | null;
  description?: string | null;
  issue_date: string;
  expected_delivery?: string | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  items?: PurchaseOrderItem[];
}

// ─── Vendor Bills ─────────────────────────────────────────────────────────────

export interface VendorBill extends Base {
  job_id: string;
  purchase_order_id?: string | null;
  vendor_id: string;
  vendor_name?: string | null;
  bill_number?: string | null;
  status: BillStatus;
  bill_date: string;
  due_date?: string | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  notes?: string | null;
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  budget_item_id?: string | null;
}

export interface Invoice extends Base {
  job_id: string;
  customer_id: string;
  customer_name?: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  balance_due: number;
  notes?: string | null;
  items?: InvoiceLineItem[];
}

// ─── Daily Logs ───────────────────────────────────────────────────────────────

export interface DailyLog extends Base {
  job_id: string;
  log_date: string;
  weather?: string | null;
  temperature_high?: number | null;
  temperature_low?: number | null;
  summary: string;
  delays?: string | null;
  visitors?: string | null;
  created_by: string;
  created_by_name?: string | null;
}

// ─── Time Tracking ────────────────────────────────────────────────────────────

export interface TimeEntry extends Base {
  job_id: string;
  user_id: string;
  user_name?: string | null;
  daily_log_id?: string | null;
  budget_item_id?: string | null;
  work_date: string;
  hours: number;
  overtime_hours: number;
  description?: string | null;
  cost_code?: string | null;
  trade_classification?: string | null;
  pay_rate: number;
  approved: boolean;
  approved_by?: string | null;
}

// ─── API response wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    per_page: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, string[]>;
  request_id?: string;
}

// ─── Subcontractor management ─────────────────────────────────────────────────

export type SubcontractStatus = 'draft' | 'active' | 'complete' | 'closed' | 'void';

export interface Subcontract {
  id: string;
  company_id: string;
  job_id: string;
  subcontractor_id: string;
  subcontract_number?: string | null;
  title: string;
  cost_code?: string | null;
  scope?: string | null;
  contract_amount: number;
  retainage_pct: number;
  status: SubcontractStatus;
  start_date?: string | null;
  end_date?: string | null;
  executed_date?: string | null;
  notes?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** A subcontract with commitment figures derived from its linked pay applications (vendor_bills). */
export interface SubcontractWithTotals extends Subcontract {
  subcontractor_name: string;
  certifications: string[];
  billed: number;         // sum of pay-app totals
  retainage_held: number; // retainage withheld across pay apps
  paid: number;           // cash paid out
  due: number;            // billed - retainage_held - paid
  remaining: number;      // contract_amount - billed (uncommitted headroom on the sub)
}

export interface SubcontractParticipation {
  total_committed: number;
  certified_committed: number;
  participation_pct: number;
  by_certification: { certification: string; committed: number }[];
}
