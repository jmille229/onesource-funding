import { useEffect, useId, useRef, useState } from "react";
import type { Cert, Subcontract, TradeKey } from "../types";
import { TRADE, PROJECT } from "../data";
import { parseAmount, usd } from "../lib/format";

interface FormState {
  firm: string;
  trade: TradeKey;
  costCode: string;
  amount: string;
  retainagePct: string;
  start: string;
  finish: string;
  scope: string;
  permits: string;
  cert: Cert;
  coi: string;
  contact: string;
}

const BLANK: FormState = {
  firm: "", trade: "concrete", costCode: "", amount: "", retainagePct: "10",
  start: "", finish: "", scope: "", permits: "", cert: "—", coi: "", contact: "",
};

const CERTS: Cert[] = ["—", "MBE", "WBE", "WBE / MBE", "DBE", "SDVOSB"];

interface Props {
  headroom: number;
  onSave: (rec: Subcontract) => void;
  onCancel: () => void;
}

export function SubcontractForm({ onSave, onCancel, headroom }: Props) {
  const [f, setF] = useState<FormState>(BLANK);
  const [err, setErr] = useState("");
  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Modal a11y: focus the first field on open, and close on Escape.
  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const set =
    <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const amt = parseAmount(f.amount);
  const willExceed = amt > headroom;

  const save = () => {
    if (!f.firm.trim()) return setErr("Enter the subcontractor's company name.");
    if (!amt) return setErr("Enter the subcontract amount so it counts against the budget.");
    if (!f.finish) return setErr("Enter an expected completion date.");
    onSave({
      id: Date.now(),
      firm: f.firm.trim(),
      trade: f.trade,
      costCode: f.costCode.trim(),
      amount: amt,
      bills: [],
      payments: [],
      retainagePct: parseAmount(f.retainagePct),
      status: "Not started",
      w9: false,
      // A blank COI stays null → "missing", instead of being backfilled with a fake date.
      coi: f.coi || null,
      start: f.start || PROJECT.start,
      finish: f.finish,
      scope: f.scope.trim() || "Scope not yet defined.",
      permits: f.permits.trim() || "None",
      cert: f.cert,
      contact: f.contact.trim() || "No contact on file",
    });
  };

  return (
    <div className="sl-scrim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sl-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--rule)", background: "var(--surface)" }}>
          <div className="sl-eyebrow">New subcontract · {PROJECT.number}</div>
          <div id={titleId} className="sl-disp" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.01em", marginTop: 4 }}>
            Commit scope to a subcontractor
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {err && (
            <div className="sl-alert" role="alert">
              <div style={{ fontSize: 13.5 }}>{err}</div>
            </div>
          )}

          <label className="sl-field">
            <span>Subcontractor company</span>
            <input ref={firstFieldRef} className="sl-input" value={f.firm} onChange={set("firm")} placeholder="e.g. Ortega Drywall LLC" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="sl-field">
              <span>Trade</span>
              <select className="sl-input" value={f.trade} onChange={set("trade")}>
                {Object.entries(TRADE).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </label>
            <label className="sl-field">
              <span>Cost code</span>
              <input className="sl-input sl-mono" value={f.costCode} onChange={set("costCode")} placeholder="09 250" />
            </label>
          </div>

          <label className="sl-field">
            <span>Scope and responsibilities</span>
            <textarea className="sl-input" value={f.scope} onChange={set("scope")}
              placeholder="What exactly is this sub responsible for — and what are they explicitly not? Exclusions prevent the argument later." />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="sl-field">
              <span>Subcontract amount</span>
              <input className="sl-input sl-mono" inputMode="numeric" value={f.amount}
                onChange={set("amount")} placeholder="48000" />
            </label>
            <label className="sl-field">
              <span>Retainage held (%)</span>
              <input className="sl-input sl-mono" inputMode="numeric" value={f.retainagePct} onChange={set("retainagePct")} />
            </label>
          </div>

          {willExceed && (
            <div className="sl-alert" style={{ borderColor: "var(--hold)", background: "#FBF2DA" }}>
              <div style={{ fontSize: 13.5 }}>
                This puts you {usd(amt - headroom)} past the contract value. You can still commit it —
                but that overage comes out of your margin unless it's covered by a change order.
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="sl-field">
              <span>Start date</span>
              <input className="sl-input sl-mono" type="date" value={f.start} onChange={set("start")} />
            </label>
            <label className="sl-field">
              <span>Expected completion</span>
              <input className="sl-input sl-mono" type="date" value={f.finish} onChange={set("finish")} />
            </label>
          </div>

          <label className="sl-field">
            <span>Permits held by this sub</span>
            <input className="sl-input" value={f.permits} onChange={set("permits")}
              placeholder="e.g. Electrical permit E-2291 — or 'None, GC holds'" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="sl-field">
              <span>Insurance expires</span>
              <input className="sl-input sl-mono" type="date" value={f.coi} onChange={set("coi")} />
            </label>
            <label className="sl-field">
              <span>Certification</span>
              <select className="sl-input" value={f.cert} onChange={set("cert")}>
                {CERTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <label className="sl-field" style={{ marginBottom: 22 }}>
            <span>Primary contact</span>
            <input className="sl-input" value={f.contact} onChange={set("contact")} placeholder="Name · phone" />
          </label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="sl-btn" data-ghost="1" onClick={onCancel}>Cancel</button>
            <button className="sl-btn" onClick={save}>Commit subcontract</button>
          </div>
        </div>
      </div>
    </div>
  );
}
