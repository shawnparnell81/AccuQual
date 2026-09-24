import { useEffect, useRef, useState } from "react";

const BEATS = [
  { step: "Detected", clock: "14:02:07", text: "Station 4, Line 3. The torque reading is 3.6 Nm; the spec calls for 4.2.", body: "An operator's reading falls outside spec. Nothing has shipped yet, and the record starts now." },
  { step: "Logged", clock: "14:04:31", text: "NCR-2447 opened, severity High.", body: "The nonconformance is logged in two minutes, with the part, station and reading attached and the operator's name on it." },
  { step: "Analyzed", clock: "14:09:12", text: "AI suggests a root cause: calibration lapsed.", body: "AI reads the record and proposes a cause. You accept or reject it, and either decision is written to the audit trail." },
  { step: "Planned", clock: "14:21:48", text: "CAPA-1188 drafted and linked to the NCR.", body: "The corrective action starts from the NCR's own facts, so nobody re-types what the system already knows." },
  { step: "Automated", clock: "14:22:05", text: "A workflow rule notifies the plant manager.", body: "Rules you configure route the right record to the right person. No chasing by email." },
  { step: "Verified", clock: "+4 days", text: "Effectiveness check passes.", body: "The CAPA stays open until someone confirms the fix worked, with the evidence attached." },
  { step: "Closed", clock: "4d 0h 42m", text: "Case closed. The audit trail is sealed.", body: "Every change, who made it and when, is on record. This walkthrough uses sample data." },
];

/** Sticky "case file" panel that follows the beat currently in view. */
export function CaseFile() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const beat = BEATS[active]!;
  return (
    <div className="lp-case">
      <aside className="lp-panel" aria-live="polite">
        <span className="lp-label">Case NCR-2447</span>
        <h3>{beat.step}</h3>
        <p className="lp-clock">{beat.clock}</p>
        <p className="lp-stagetext">{beat.text}</p>
        <ol className="lp-rail">
          {BEATS.map((b, i) => (
            <li key={b.step} className={i <= active ? "on" : undefined}>{b.step}</li>
          ))}
        </ol>
      </aside>
      <div>
        {BEATS.map((b, i) => (
          <div key={b.step} data-i={i} ref={(el) => { refs.current[i] = el; }} className={`lp-beat${i === active ? " on" : ""}`}>
            <span className="lp-mono">{String(i + 1).padStart(1, "0")} of {BEATS.length} · {b.clock}</span>
            <h3>{b.step}</h3>
            <p>{b.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
