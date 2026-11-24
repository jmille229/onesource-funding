/** Who may create a job (the API's POST /jobs allows the same roles). */
export const canCreateJobs = (role?: string) => ['owner', 'admin', 'project_manager'].includes(role ?? '');

/** Contract value less what's been billed; null when the job has no contract value. */
export function leftToBill(contract: unknown, billed: unknown): number | null {
  if (contract === null || contract === undefined || contract === '') return null;
  return Number(contract) - Number(billed ?? 0);
}

/** Share of the contract billed so far, 0–100, or null without a contract value. */
export function billedPct(contract: unknown, billed: unknown): number | null {
  const c = Number(contract);
  if (!(c > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((Number(billed ?? 0) / c) * 100)));
}
