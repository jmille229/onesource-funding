import { useMemo, useState } from "react";
import type { Subcontract } from "./types";
import { PROJECT, SEED, TRADE } from "./data";
import { coiState, shortDate, usd } from "./lib/format";
import { useLocalStorage } from "./lib/useLocalStorage";
import { CommitmentRail } from "./components/CommitmentRail";
import { SubcontractForm } from "./components/SubcontractForm";

const STORAGE_KEY = "subledger:subs:v1";

const flagLabel: Record<string, string> = {
  expired: "COI expired",
  soon: "COI expiring",
  missing: "COI missing",
};

export default function App() {
  const [subs, setSubs] = useLocalStorage<Subcontract[]>(STORAGE_KEY, SEED);
  const [tab, setTab] = useState<"project" | "subs">("project");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const m = useMemo(() => {
    const committed = subs.reduce((s, x) => s + x.amount, 0);
    const billed = subs.reduce((s, x) => s + x.billed, 0);
    const held = subs.reduce((s, x) => s + x.billed * (x.retainagePct / 100), 0);
    // Billed to date, net of retainage withheld. NOTE: not the same as cash paid —
    // an explicit payments ledger is the next iteration; until then this is what the
    // sub has earned and can collect, not what has actually gone out the door.
    const netBilled = billed - held;
    const unbilled = committed - billed;
    const cv = PROJECT.contractValue;
    const over = Math.max(0, committed - cv);
    return {
      committed, billed, held, netBilled, unbilled, over,
      headroom: Math.max(0, cv - committed),
      // segments clipped so the rail never double-counts the overrun
      segNetBilled: Math.min(netBilled, cv),
      segHeld: Math.min(held, Math.max(0, cv - netBilled)),
      segUnbilled: Math.min(unbilled, Math.max(0, cv - netBilled - held)),
    };
  }, [subs]);

  const coiProblems = subs.filter((s) => coiState(s.coi).key !== "ok");

  return (
    <div className="sl">
      <header className="sl-bar">
        <div className="sl-barin">
          <div className="sl-mark">
            <div className="sl-marksq" />
            <span className="sl-disp" style={{ fontWeight: 700, fontSize: 15, letterSpacing: ".02em" }}>
              SUBLEDGER
            </span>
          </div>
          <nav style={{ display: "flex", gap: 20 }}>
            <button className="sl-tab" data-on={tab === "project" ? 1 : 0} onClick={() => setTab("project")}>
              Job
            </button>
            <button className="sl-tab" data-on={tab === "subs" ? 1 : 0} onClick={() => setTab("subs")}>
              Subcontractors
            </button>
          </nav>
          <div className="sl-eyebrow" style={{ marginLeft: "auto" }}>
            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </header>

      <div className="sl-wrap">
        {tab === "project" && (
          <>
            <section style={{ paddingTop: 34 }}>
              <div className="sl-eyebrow">Job {PROJECT.number}</div>
              <h1 className="sl-h1">{PROJECT.name}</h1>
              <div className="sl-sub">
                {PROJECT.address} &nbsp;·&nbsp; {PROJECT.client} &nbsp;·&nbsp;{" "}
                {shortDate(PROJECT.start)} – {shortDate(PROJECT.finish)}
              </div>

              <CommitmentRail
                contractValue={PROJECT.contractValue}
                netBilled={m.segNetBilled} held={m.segHeld} unbilled={m.segUnbilled} over={m.over}
              />

              <div className="sl-keys">
                <div className="sl-key">
                  <div className="sl-eyebrow">
                    <span className="sl-swatch" style={{ background: "var(--deep)" }} />Billed, net of retainage
                  </div>
                  <div className="sl-keynum">{usd(m.netBilled)}</div>
                </div>
                <div className="sl-key">
                  <div className="sl-eyebrow">
                    <span className="sl-swatch" style={{ background: "var(--hold)" }} />Retainage held
                  </div>
                  <div className="sl-keynum">{usd(m.held)}</div>
                </div>
                <div className="sl-key">
                  <div className="sl-eyebrow">
                    <span className="sl-swatch" style={{ background: "var(--mid)" }} />Committed, not billed
                  </div>
                  <div className="sl-keynum">{usd(m.unbilled)}</div>
                </div>
                <div className="sl-key">
                  <div className="sl-eyebrow">
                    <span className="sl-swatch" style={{ background: m.over ? "var(--over)" : "#D6D5D0" }} />
                    {m.over ? "Over contract" : "Left to commit"}
                  </div>
                  <div className="sl-keynum" style={{ color: m.over ? "var(--over)" : undefined }}>
                    {usd(m.over || m.headroom)}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: "var(--graphite)", marginTop: 12, maxWidth: 640, lineHeight: 1.55 }}>
                {m.over
                  ? "You have committed more to subs than the owner is paying you. Everything past the contract line comes out of your own margin."
                  : `That ${usd(m.headroom)} still has to cover your own labor, materials, overhead and profit — it is not free money.`}
              </p>
            </section>

            {coiProblems.length > 0 && (
              <div className="sl-alert" style={{ marginTop: 30 }}>
                <div>
                  <div className="sl-disp" style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>
                    {coiProblems.length} {coiProblems.length === 1 ? "sub needs" : "subs need"} a current insurance certificate
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {coiProblems.map((s) => s.firm).join(", ")}. If they get hurt on your job without coverage,
                    the claim lands on your policy.
                  </div>
                </div>
              </div>
            )}

            <section style={{ marginTop: 34 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                <div className="sl-eyebrow">Subcontracts ({subs.length})</div>
                <button className="sl-btn" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
                  Add subcontract
                </button>
              </div>

              <div className="sl-card">
                <div className="sl-rowhead">
                  <div />
                  <div className="sl-eyebrow">Code</div>
                  <div className="sl-eyebrow">Subcontractor</div>
                  <div className="sl-eyebrow" style={{ textAlign: "right" }}>Committed</div>
                  <div className="sl-eyebrow" style={{ textAlign: "right" }}>Billed</div>
                  <div className="sl-eyebrow" style={{ textAlign: "right" }}>Due</div>
                  <div />
                </div>

                {subs.length === 0 && (
                  <div className="sl-empty">
                    No scope committed yet. Add your first subcontract to start tracking what you owe.
                  </div>
                )}

                {subs.map((s) => {
                  const t = TRADE[s.trade] || TRADE.concrete;
                  const c = coiState(s.coi);
                  const isOpen = open === s.id;
                  const pctBilled = s.amount ? Math.min(100, (s.billed / s.amount) * 100) : 0;
                  return (
                    <div key={s.id}>
                      <button className="sl-row" onClick={() => setOpen(isOpen ? null : s.id)}
                        aria-expanded={isOpen}>
                        <div className="sl-tick5" style={{ background: t.color }} />
                        <div className="sl-mono sl-hidesm" style={{ fontSize: 12, color: "var(--graphite)" }}>
                          {s.costCode}
                        </div>
                        <div>
                          <div className="sl-firm">{s.firm}</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                            <span className="sl-eyebrow">{t.label} · {s.status}</span>
                            {c.key !== "ok" && (
                              <span className="sl-flag" style={{ color: c.color, borderColor: c.color }}>
                                {flagLabel[c.key]}
                              </span>
                            )}
                            {s.cert !== "—" && (
                              <span className="sl-flag" style={{ color: "#2E7D5B", borderColor: "#2E7D5B" }}>
                                {s.cert}
                              </span>
                            )}
                          </div>
                          <div className="sl-mini"><div className="sl-minifill" style={{ width: `${pctBilled}%` }} /></div>
                        </div>
                        <div className="sl-num sl-hidesm">{usd(s.amount)}</div>
                        <div className="sl-num sl-hidesm" style={{ color: "var(--graphite)" }}>{usd(s.billed)}</div>
                        <div className="sl-num sl-hidesm" style={{ fontSize: 12, color: "var(--graphite)" }}>
                          {shortDate(s.finish)}
                        </div>
                        <div className="sl-mono" style={{ textAlign: "center", color: "var(--graphite)" }}>
                          {isOpen ? "−" : "+"}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="sl-detail">
                          <dl className="sl-dl" style={{ gridColumn: "1 / -1", margin: 0 }}>
                            <dt>Scope and responsibilities</dt>
                            <dd style={{ maxWidth: 720 }}>{s.scope}</dd>
                          </dl>
                          <dl className="sl-dl" style={{ margin: 0 }}>
                            <dt>Money</dt>
                            <dd className="sl-mono" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                              Committed {usd(s.amount)}<br />
                              Billed to date {usd(s.billed)}<br />
                              Retainage held {usd(s.billed * (s.retainagePct / 100))} ({s.retainagePct}%)<br />
                              Remaining {usd(s.amount - s.billed)}
                            </dd>
                          </dl>
                          <dl className="sl-dl" style={{ margin: 0 }}>
                            <dt>Dates</dt>
                            <dd>{shortDate(s.start)} → {shortDate(s.finish)}</dd>
                            <dt style={{ marginTop: 14 }}>Permits</dt>
                            <dd>{s.permits}</dd>
                          </dl>
                          <dl className="sl-dl" style={{ margin: 0 }}>
                            <dt>Compliance</dt>
                            <dd style={{ lineHeight: 1.7 }}>
                              <span style={{ color: c.color }}>{c.label}</span><br />
                              W-9 {s.w9 ? "on file" : "not received"}<br />
                              {s.cert !== "—" ? `Certified ${s.cert}` : "No certification on file"}
                            </dd>
                            <dt style={{ marginTop: 14 }}>Contact</dt>
                            <dd>{s.contact}</dd>
                          </dl>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {tab === "subs" && (
          <section style={{ paddingTop: 34 }}>
            <div className="sl-eyebrow">Directory</div>
            <h1 className="sl-h1" style={{ fontSize: "clamp(26px,4vw,36px)" }}>Subcontractors</h1>
            <p className="sl-sub" style={{ maxWidth: 560, lineHeight: 1.55 }}>
              Firm records live here and get reused across every job, so insurance and tax paperwork
              is entered once. Certification status feeds your participation reports.
            </p>

            <div className="sl-card" style={{ marginTop: 24 }}>
              {subs.map((s) => {
                const t = TRADE[s.trade] || TRADE.concrete;
                const c = coiState(s.coi);
                return (
                  <div key={s.id} style={{
                    display: "flex", gap: 14, alignItems: "center", padding: "14px 16px 14px 0",
                    borderBottom: "1px solid var(--rule)", flexWrap: "wrap",
                  }}>
                    <div className="sl-tick5" style={{ background: t.color }} />
                    <div style={{ minWidth: 190, flex: 1 }}>
                      <div className="sl-firm">{s.firm}</div>
                      <div className="sl-eyebrow" style={{ marginTop: 3 }}>{t.label} · {s.contact}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: c.color, minWidth: 170 }}>{c.label}</div>
                    <div className="sl-eyebrow" style={{ minWidth: 120 }}>
                      W-9 {s.w9 ? "on file" : "missing"}
                    </div>
                    <div style={{ minWidth: 88 }}>
                      {s.cert !== "—" && (
                        <span className="sl-flag" style={{ color: "#2E7D5B", borderColor: "#2E7D5B" }}>{s.cert}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sl-card" style={{ marginTop: 26, padding: 20 }}>
              <div className="sl-eyebrow">Participation report · {PROJECT.number}</div>
              <div className="sl-disp" style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.02em", margin: "8px 0 4px" }}>
                {Math.round(
                  (subs.filter((s) => s.cert !== "—").reduce((a, s) => a + s.amount, 0) /
                    Math.max(1, subs.reduce((a, s) => a + s.amount, 0))) * 100
                )}%
              </div>
              <div style={{ fontSize: 13, color: "var(--graphite)", maxWidth: 520, lineHeight: 1.55 }}>
                of committed subcontract value is with certified MBE, WBE, DBE or SDVOSB firms.
                Export this for owner and agency reporting.
              </div>
            </div>
          </section>
        )}
      </div>

      {adding && (
        <SubcontractForm
          headroom={m.headroom}
          onCancel={() => setAdding(false)}
          onSave={(rec) => { setSubs([...subs, rec]); setAdding(false); setOpen(rec.id); }}
        />
      )}
    </div>
  );
}
