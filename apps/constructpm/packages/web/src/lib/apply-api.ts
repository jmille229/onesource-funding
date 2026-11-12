import axios from 'axios';

/**
 * Client for the public funding application (apply.os-funding.com).
 *
 * Separate from the tenant client: there is no login here. The applicant's
 * resume token rides in the X-Application-Token header, and in the page URL it
 * lives in the fragment (#t=…), which browsers never send to a server — so it
 * stays out of access logs and Referer headers. It is held in memory, not in
 * localStorage; the link itself is how an applicant gets back in.
 */
let _token: string | null = null;

export function setApplicationToken(t: string | null) { _token = t; }
export function getApplicationToken() { return _token; }

export const applyApi = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || '/api'}/apply`,
  timeout: 120_000, // uploads of phone photos over a slow connection
});

applyApi.interceptors.request.use((config) => {
  if (_token) config.headers['X-Application-Token'] = _token;
  return config;
});

/** Token from the current URL fragment, if any (#t=…). */
export function tokenFromLocation(): string | null {
  const m = /(?:^|[#&])t=([A-Za-z0-9_-]{20,200})/.exec(window.location.hash);
  return m ? m[1]! : null;
}

/** The private link to this application, for the applicant to keep. */
export function resumeLinkFor(token: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#t=${token}`;
}

export interface Requirement {
  key: string; label: string; description: string | null;
  kind: 'document' | 'ein' | 'ssn'; required: boolean; has_template: boolean;
}

export interface ApplicationItem {
  id: string; requirement_key: string; kind: 'document' | 'ein' | 'ssn';
  source: 'applicant' | 'operator'; note: string | null; created_at: string;
  original_name?: string | null; size_bytes?: number | null; masked?: string;
}

export interface Application {
  id: string; status: string;
  contact_first_name: string; contact_last_name: string; contact_email: string; contact_phone: string | null;
  legal_name: string; dba: string | null; entity_type: string | null; state_of_formation: string | null;
  years_in_business: string | number | null;
  address_line1: string | null; city: string | null; state_code: string | null; zip: string | null;
  agencies: string | null; monthly_volume: string | number | null; typical_invoice: string | number | null;
  typical_days_to_pay: number | null; has_existing_lender: boolean | null; existing_lender: string | null;
  owner_name: string | null; owner_title: string | null; owner_ownership_pct: string | number | null;
  signer_name: string | null; signer_title: string | null; how_heard: string | null;
  signature_name: string | null; signed_at: string | null; submitted_at: string | null;
  request_message: string | null; requested_items: string[] | null;
}

export interface ApplicationState {
  application: Application;
  items: ApplicationItem[];
  requirements: Requirement[];
  missing: { fields: { key: string; label: string }[]; items: { key: string; label: string }[] };
  editable: boolean;
}

/** The API's message, including the first field error from a 422. */
export function applyError(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { message?: string; details?: Record<string, string[]> } } })
    ?.response?.data;
  if (d?.details) {
    const first = Object.entries(d.details).find(([, v]) => v?.length);
    if (first) return `${FIELD_NAMES[first[0]] ?? first[0]}: ${first[1][0]}`;
  }
  if ((e as { code?: string })?.code === 'ECONNABORTED') return 'The connection timed out. Please try again.';
  return d?.message ?? fallback;
}

const FIELD_NAMES: Record<string, string> = {
  first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone',
  legal_name: 'Legal business name', contact_first_name: 'First name', contact_last_name: 'Last name',
  contact_email: 'Email', contact_phone: 'Phone', dba: 'DBA', entity_type: 'Entity type',
  state_of_formation: 'State of formation', years_in_business: 'Years in business',
  address_line1: 'Street address', city: 'City', state_code: 'State', zip: 'ZIP code',
  agencies: 'Agencies', monthly_volume: 'Monthly invoicing', typical_invoice: 'Typical invoice',
  typical_days_to_pay: 'Days to pay', existing_lender: 'Current lender', owner_name: 'Owner name',
  owner_title: 'Owner title', owner_ownership_pct: 'Ownership %', signer_name: 'Signer name',
  signer_title: 'Signer title', how_heard: 'How you heard', signature_name: 'Signature', value: 'Number',
};
