/** Three line-drawn shop-floor scenes. Purely illustrative (no photos), drawn to the page palette. */

const SCENES = [
  { tag: "Measure", title: "Every gauge, in calibration", text: "Calibration due dates, certificates and out-of-tolerance history for the tools on your floor.", art: <Caliper /> },
  { tag: "Receive & ship", title: "Every load, on the record", text: "Incoming lots and outgoing shipments tie back to inspections, suppliers and inventory.", art: <Dock /> },
  { tag: "Inspect", title: "Every finding, followed up", text: "Audit and inspection results turn into nonconformances and corrective actions, not loose paper.", art: <Inspection /> },
];

export function Scenes() {
  return (
    <div className="lp-scenes">
      {SCENES.map((s) => (
        <figure key={s.tag} className="lp-scene">
          <div className="lp-scene-art">{s.art}</div>
          <figcaption>
            <span className="lp-mono">{s.tag}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={label} className="lp-svg" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function Caliper() {
  const ticks = Array.from({ length: 22 }, (_, i) => 30 + i * 12);
  return (
    <Frame label="A vernier caliper measuring a round part">
      {/* beam */}
      <rect x="20" y="118" width="280" height="26" stroke="var(--lp-dim)" fill="var(--lp-bg)" />
      {ticks.map((x, i) => (
        <line key={x} x1={x} y1="118" x2={x} y2={i % 5 === 0 ? 132 : 126} stroke="var(--lp-dim)" strokeWidth="1.5" />
      ))}
      {/* fixed jaw */}
      <path d="M20 118 V54 H48 V118" stroke="var(--lp-text)" fill="var(--lp-bg2)" />
      {/* part being measured */}
      <rect x="48" y="70" width="112" height="48" stroke="var(--lp-evidence)" fill="rgba(143,211,255,0.08)" />
      <line x1="48" y1="94" x2="160" y2="94" stroke="var(--lp-evidence)" strokeDasharray="3 5" strokeWidth="1.2" />
      {/* sliding jaw */}
      <g className="lp-slide">
        <path d="M160 118 V54 H188 V118 M160 144 V158 H210 V144" stroke="var(--lp-manila)" fill="var(--lp-bg2)" />
        <rect x="160" y="118" width="70" height="26" stroke="var(--lp-manila)" fill="var(--lp-bg2)" />
      </g>
      {/* readout */}
      <rect x="196" y="20" width="96" height="40" stroke="var(--lp-text)" fill="var(--lp-bg)" />
      <text x="244" y="47" textAnchor="middle" fontFamily="var(--lp-mono)" fontSize="18" fill="var(--lp-manila)" stroke="none">112.0</text>
      <text x="244" y="72" textAnchor="middle" fontFamily="var(--lp-mono)" fontSize="9" fill="var(--lp-dim)" stroke="none" letterSpacing="2">MM</text>
    </Frame>
  );
}

function Dock() {
  return (
    <Frame label="A truck backed to a loading dock with a forklift moving a pallet">
      {/* ground */}
      <line x1="10" y1="170" x2="310" y2="170" stroke="var(--lp-line)" />
      {/* dock building */}
      <path d="M10 170 V70 H120 V170" stroke="var(--lp-dim)" fill="var(--lp-bg2)" />
      <rect x="34" y="96" width="62" height="74" stroke="var(--lp-text)" />
      {[108, 120, 132, 144, 156].map((y) => (
        <line key={y} x1="34" y1={y} x2="96" y2={y} stroke="var(--lp-line)" strokeWidth="1.2" />
      ))}
      {/* truck box */}
      <rect x="196" y="72" width="108" height="86" stroke="var(--lp-manila)" fill="var(--lp-bg2)" />
      <circle cx="226" cy="164" r="9" stroke="var(--lp-text)" fill="var(--lp-bg)" />
      <circle cx="280" cy="164" r="9" stroke="var(--lp-text)" fill="var(--lp-bg)" />
      {/* boxes inside truck */}
      <rect x="252" y="116" width="40" height="42" stroke="var(--lp-manila)" />
      <rect x="206" y="128" width="40" height="30" stroke="var(--lp-manila)" />
      {/* forklift */}
      <g className="lp-fork">
        <rect x="112" y="128" width="46" height="26" stroke="var(--lp-evidence)" fill="var(--lp-bg)" />
        <path d="M122 128 V108 H146 V128" stroke="var(--lp-evidence)" />
        <circle cx="124" cy="160" r="8" stroke="var(--lp-evidence)" fill="var(--lp-bg)" />
        <circle cx="148" cy="160" r="8" stroke="var(--lp-evidence)" fill="var(--lp-bg)" />
        <path d="M158 96 V156 M158 150 H184" stroke="var(--lp-evidence)" />
        <rect x="160" y="124" width="32" height="26" stroke="var(--lp-text)" fill="rgba(233,230,220,0.06)" />
      </g>
      {/* scan tag */}
      <rect x="160" y="30" width="72" height="26" stroke="var(--lp-ok)" />
      <path d="M170 38 V48 M176 38 V48 M181 38 V48 M188 38 V48 M194 38 V48 M200 38 V48" stroke="var(--lp-ok)" strokeWidth="1.5" />
      <path d="M212 44 l5 5 l9 -10" stroke="var(--lp-ok)" />
    </Frame>
  );
}

function Inspection() {
  const teeth = Array.from({ length: 12 }, (_, i) => (i * Math.PI * 2) / 12);
  return (
    <Frame label="A magnifying glass over a machined part beside an inspection checklist">
      {/* checklist */}
      <rect x="196" y="24" width="96" height="140" stroke="var(--lp-text)" fill="var(--lp-bg2)" />
      <rect x="230" y="18" width="28" height="12" stroke="var(--lp-manila)" fill="var(--lp-bg)" />
      {[52, 82, 112, 142].map((y, i) => (
        <g key={y}>
          <rect x="208" y={y - 8} width="14" height="14" stroke="var(--lp-dim)" />
          {i < 3 ? <path d={`M211 ${y - 1} l4 4 l7 -9`} stroke="var(--lp-ok)" /> : <path d={`M211 ${y - 5} l8 8 M219 ${y - 5} l-8 8`} stroke="var(--lp-critical)" />}
          <line x1="232" y1={y} x2="280" y2={y} stroke="var(--lp-line)" />
        </g>
      ))}
      {/* part: gear */}
      <g stroke="var(--lp-evidence)">
        <circle cx="92" cy="98" r="34" fill="rgba(143,211,255,0.08)" />
        <circle cx="92" cy="98" r="11" />
        {teeth.map((a) => (
          <line key={a} x1={92 + Math.cos(a) * 34} y1={98 + Math.sin(a) * 34} x2={92 + Math.cos(a) * 44} y2={98 + Math.sin(a) * 44} strokeWidth="7" />
        ))}
      </g>
      {/* magnifier */}
      <g className="lp-glass">
        <circle cx="118" cy="82" r="30" stroke="var(--lp-manila)" fill="rgba(216,174,51,0.08)" />
        <line x1="140" y1="104" x2="172" y2="140" stroke="var(--lp-manila)" strokeWidth="7" />
      </g>
    </Frame>
  );
}
