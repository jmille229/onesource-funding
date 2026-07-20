import { useEffect, useId, useRef, useState } from "react";
import type { Bill, Payment } from "../types";
import { parseAmount, usd } from "../lib/format";

export type LedgerKind = "bill" | "payment";

interface Props {
  kind: LedgerKind;
  firm: string;
  /** For a bill, show how much retainage this billing will withhold. */
  retainagePct: number;
  onSave: (entry: Bill | Payment) => void;
  onCancel: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function LedgerEntryForm({ kind, firm, retainagePct, onSave, onCancel }: Props) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const titleId = useId();
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const amt = parseAmount(amount);
  const isBill = kind === "bill";
  const retainage = isBill ? amt * (retainagePct / 100) : 0;

  const save = () => {
    if (!amt) return setErr(`Enter the ${isBill ? "bill" : "payment"} amount.`);
    if (!date) return setErr("Enter a date.");
    onSave({ id: Date.now(), date, amount: amt, note: note.trim() || undefined });
  };

  return (
    <div className="sl-scrim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sl-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: 460 }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--rule)", background: "var(--surface)" }}>
          <div className="sl-eyebrow">{firm}</div>
          <div id={titleId} className="sl-disp" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em", marginTop: 4 }}>
            {isBill ? "Record a bill" : "Record a payment"}
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {err && (
            <div className="sl-alert" role="alert">
              <div style={{ fontSize: 13.5 }}>{err}</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <label className="sl-field">
              <span>{isBill ? "Bill amount" : "Payment amount"}</span>
              <input ref={amountRef} className="sl-input sl-mono" inputMode="numeric"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
            </label>
            <label className="sl-field">
              <span>Date</span>
              <input className="sl-input sl-mono" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          {isBill && amt > 0 && retainagePct > 0 && (
            <p style={{ fontSize: 12.5, color: "var(--graphite)", margin: "0 0 15px", lineHeight: 1.5 }}>
              You hold {usd(retainage)} retainage ({retainagePct}%) on this bill — the sub can
              collect {usd(amt - retainage)} now.
            </p>
          )}

          <label className="sl-field" style={{ marginBottom: 22 }}>
            <span>Note (optional)</span>
            <input className="sl-input" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={isBill ? "e.g. Rough-in, draw 2" : "e.g. Check #1042"} />
          </label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="sl-btn" data-ghost="1" onClick={onCancel}>Cancel</button>
            <button className="sl-btn" onClick={save}>{isBill ? "Record bill" : "Record payment"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
