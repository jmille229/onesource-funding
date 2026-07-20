import React from "react";
import { usd } from "../lib/format";

interface Props {
  contractValue: number;
  /** Billed to date, net of retainage withheld. */
  netBilled: number;
  held: number;
  unbilled: number;
  over: number;
}

export function CommitmentRail({ contractValue, netBilled, held, unbilled, over }: Props) {
  const scaleMax = Math.max(contractValue, netBilled + held + unbilled + over);
  const pct = (v: number) => `${(v / scaleMax) * 100}%`;

  const step = 50000;
  const ticks: number[] = [];
  for (let v = step; v < scaleMax; v += step) ticks.push(v);

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ position: "relative" }}>
        <div className="sl-rail">
          <div className="sl-seg" style={{ width: pct(netBilled), background: "var(--deep)" }} />
          <div className="sl-seg" style={{ width: pct(held), background: "var(--hold)" }} />
          <div className="sl-seg" style={{ width: pct(unbilled), background: "var(--mid)" }} />
          {over > 0 && <div className="sl-seg sl-hazard" style={{ width: pct(over) }} />}
        </div>

        <div className="sl-contractline" style={{ left: pct(contractValue) }} />
        <div className="sl-contractflag" style={{ left: pct(contractValue) }}>
          Contract {usd(contractValue)}
        </div>

        <div className="sl-ticks">
          {ticks.map((v) => (
            <React.Fragment key={v}>
              <div className="sl-tick" style={{ left: pct(v), height: v % 100000 === 0 ? 9 : 5 }} />
              {v % 100000 === 0 && (
                <div className="sl-ticklab" style={{ left: pct(v) }}>{v / 1000}k</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
