export const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

export const shortDate = (iso: string): string =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Today at local noon, so day-diff math is not thrown off by DST or the clock time. */
function today(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

export const daysUntil = (iso: string): number =>
  Math.round((new Date(iso + "T12:00:00").getTime() - today().getTime()) / 86400000);

export type CoiKey = "ok" | "soon" | "expired" | "missing";
export interface CoiState {
  key: CoiKey;
  label: string;
  color: string;
}

/**
 * A blank/`null` COI is reported as "missing" rather than silently treated as
 * covered — in a compliance tool, "unknown" must never read as "insured."
 */
export function coiState(iso: string | null): CoiState {
  if (!iso) {
    return { key: "missing", label: "No insurance certificate on file", color: "#B23127" };
  }
  const d = daysUntil(iso);
  if (d < 0) return { key: "expired", label: `Insurance expired ${Math.abs(d)}d ago`, color: "#B23127" };
  if (d <= 30) return { key: "soon", label: `Insurance expires in ${d}d`, color: "#B07A08" };
  return { key: "ok", label: `Insured through ${shortDate(iso)}`, color: "#2E7D5B" };
}

/** Parse a currency-ish string ("48,000", "$48000", "48000.50") to a number. */
export function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
