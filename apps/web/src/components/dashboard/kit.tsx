import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useCountUp } from "../../hooks/useCountUp";

export type Tone = "primary" | "success" | "warning" | "danger" | "info";

const TONE_VAR: Record<Tone, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
  info: "var(--info)",
};

const toneStyle = (tone: Tone): CSSProperties => ({ ["--tone" as string]: TONE_VAR[tone] });

/** Fades a block up, staggered by `index`. */
export function Reveal({ index = 0, className = "", children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`reveal ${className}`} style={{ ["--d" as string]: `${index * 70}ms` }}>
      {children}
    </div>
  );
}

/** A number that counts up on load. Strings ("—", "$1,200") render as given. */
export function AnimatedNumber({ value, format }: { value: number | string; format?: (n: number) => string }) {
  const numeric = typeof value === "number" ? value : 0;
  const shown = useCountUp(numeric);
  if (typeof value !== "number") return <>{value}</>;
  const rounded = Number.isInteger(value) ? Math.round(shown) : shown;
  return <>{format ? format(rounded) : rounded.toLocaleString()}</>;
}

/** Tiny trend line that draws itself in. Needs at least two points. */
export function Sparkline({ values, tone = "primary", width = 96, height = 34 }: { values: number[]; tone?: Tone; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, height - pad - ((v - min) / span) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)},${height} L${pts[0]![0].toFixed(1)},${height} Z`;
  const color = `hsl(${TONE_VAR[tone]})`;
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <path d={area} fill={color} opacity={0.14} />
      <path d={line} pathLength={1} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="spark-line" />
      <circle cx={last[0]} cy={last[1]} r={2.8} fill={color} />
    </svg>
  );
}

/** Headline metric: big number, optional trend + link. */
export function KpiTile({
  label,
  value,
  sub,
  trend,
  tone = "primary",
  href,
  format,
  index = 0,
}: {
  label: string;
  value: number | string;
  sub?: string;
  trend?: number[];
  tone?: Tone;
  href?: string;
  format?: (n: number) => string;
  index?: number;
}) {
  const body = (
    <>
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {href && <ArrowUpRight size={14} className="text-muted-foreground" />}
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-3">
        <p className="text-4xl font-semibold leading-none tabular-nums">
          <AnimatedNumber value={value} format={format} />
        </p>
        {trend && <Sparkline values={trend} tone={tone} />}
      </div>
      {sub && <p className="relative mt-2 text-xs text-muted-foreground">{sub}</p>}
    </>
  );
  const cls = "kpi-tile reveal block rounded-xl p-4";
  const style = { ...toneStyle(tone), ["--d" as string]: `${index * 70}ms` } as CSSProperties;
  return href ? (
    <Link to={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={`${cls} kpi-hover`} style={style}>
      {body}
    </div>
  );
}

/** Circular gauge, 0-100, that fills in on load. */
export function HealthRing({ value, label, sub, tone = "success", size = 132 }: { value: number; label: string; sub?: string; tone?: Tone; size?: number }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = filled ? c * (1 - clamped / 100) : c;
  const color = `hsl(${TONE_VAR[tone]})`;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.2,0.7,0.2,1) 0.2s", filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums">
            <AnimatedNumber value={clamped} />
            <span className="text-lg text-muted-foreground">%</span>
          </span>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

/** Segmented control for switching a page's sections. */
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={value === tab.key}
          onClick={() => onChange(tab.key)}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
            value === tab.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
