import { useState } from "react";

/** Illustrative drift model for the sample torque station. Not real telemetry. */
export function TwinSlider() {
  const [factor, setFactor] = useState(2);
  const pct = Math.min(97, Math.round(1.2 * factor * factor * 0.55 * 10) / 10);
  const level = pct < 8 ? { color: "var(--lp-ok)", text: "Within tolerance" } : pct < 30 ? { color: "var(--lp-manila)", text: "Drift alert raised" } : { color: "var(--lp-critical)", text: "Out of tolerance: NCR suggested" };
  return (
    <div className="lp-gauge">
      <span className="lp-label">Sample station · torque</span>
      <p className="lp-big" style={{ color: level.color, marginTop: 8 }}>{pct}%</p>
      <p>{level.text}</p>
      <div className="lp-meter" aria-hidden="true"><i style={{ width: `${pct}%`, background: level.color }} /></div>
      <label htmlFor="lp-drift" className="lp-mono" style={{ display: "block", marginTop: 18 }}>Simulated drift: {factor.toFixed(1)}×</label>
      <input id="lp-drift" className="lp-range" type="range" min={1} max={6} step={0.1} value={factor} onChange={(e) => setFactor(Number(e.target.value))} />
    </div>
  );
}
