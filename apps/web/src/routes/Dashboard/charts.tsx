/** Small SVG charts for the dashboard. Colors come from the theme tokens. */

function color(token: string) {
  return `hsl(var(--${token}))`;
}

export function Sparkline({ values, token = "primary" }: { values: number[]; token?: string }) {
  if (values.length === 0) return null;
  const w = 80;
  const h = 26;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const d = values
    .map((value, i) => {
      const x = (i / (values.length - 1 || 1)) * w;
      const y = h - 3 - ((value - min) / (max - min || 1)) * (h - 6);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="h-[26px] w-20 shrink-0" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={color(token)} strokeWidth="2" strokeLinecap="round" className="spark-line" pathLength={1} />
    </svg>
  );
}

function niceMax(values: number[]) {
  const max = Math.max(4, ...values);
  return Math.ceil(max / 4) * 4;
}

export function TrendChart({ labels, opened, closed }: { labels: string[]; opened: number[]; closed: number[] }) {
  const W = 640;
  const H = 220;
  const L = 36;
  const R = 12;
  const T = 14;
  const B = 28;
  const top = niceMax([...opened, ...closed]);
  const x = (i: number) => L + (i / (labels.length - 1 || 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const openedPath = path(opened);
  const step = Math.ceil(labels.length / 8);
  return (
    <svg className="dash-chart h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Issues opened and closed per week, last 12 weeks">
      <defs>
        <linearGradient id="dash-opened" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color("primary")} stopOpacity="0.28" />
          <stop offset="1" stopColor={color("primary")} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((k) => {
        const v = (top / 4) * k;
        return (
          <g key={k}>
            <line className="gridl" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        );
      })}
      {labels.map((label, i) =>
        i % step === 0 || i === labels.length - 1 ? (
          <text key={label + i} x={x(i)} y={H - 8} textAnchor="middle">
            {label}
          </text>
        ) : null,
      )}
      <path d={`${openedPath} L${x(opened.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#dash-opened)" />
      <path d={openedPath} fill="none" stroke={color("primary")} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" className="series" />
      <path d={path(closed)} fill="none" stroke={color("success")} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {opened.map((v, i) => (
        <circle key={`o${i}`} cx={x(i)} cy={y(v)} r="3" fill={color("card")} stroke={color("primary")} strokeWidth="2">
          <title>{`${labels[i]}: ${v} opened`}</title>
        </circle>
      ))}
      {closed.map((v, i) => (
        <circle key={`c${i}`} cx={x(i)} cy={y(v)} r="3" fill={color("card")} stroke={color("success")} strokeWidth="2">
          <title>{`${labels[i]}: ${v} closed`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function ParetoChart({ items }: { items: { label: string; value: number }[] }) {
  const W = 640;
  const H = 250;
  const L = 36;
  const R = 42;
  const T = 16;
  const B = 64;
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const max = Math.max(1, ...items.map((item) => item.value));
  const bw = (W - L - R) / items.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const yp = (p: number) => T + (1 - p) * (H - T - B);
  let cum = 0;
  const pts = items.map((item, i) => {
    cum += item.value;
    return [L + i * bw + bw / 2, yp(cum / total)] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg className="dash-chart h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pareto chart of recorded root causes">
      <defs>
        <linearGradient id="dash-pareto" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color("primary")} />
          <stop offset="1" stopColor={color("primary")} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1={L} x2={W - R} y1={yp(0.8)} y2={yp(0.8)} stroke={color("warning")} strokeDasharray="4 4" opacity="0.8" />
      <text x={W - R + 4} y={yp(0.8) + 3} fill={color("warning")}>
        80%
      </text>
      <text x={W - R + 4} y={yp(1) + 3}>
        100%
      </text>
      <text x={L - 6} y={y(max) + 3} textAnchor="end">
        {max}
      </text>
      <text x={L - 6} y={y(0) + 3} textAnchor="end">
        0
      </text>
      {items.map((item, i) => {
        const x0 = L + i * bw + bw * 0.14;
        const w = bw * 0.72;
        const label = item.label.length > 16 ? `${item.label.slice(0, 15)}…` : item.label;
        return (
          <g key={item.label}>
            <rect x={x0} y={y(item.value)} width={w} height={Math.max(0, y(0) - y(item.value))} rx="4" fill="url(#dash-pareto)">
              <title>{`${item.label}: ${item.value} (${Math.round((item.value / total) * 100)}%)`}</title>
            </rect>
            <text className="axis" x={x0 + w / 2} y={y(item.value) - 5} textAnchor="middle">
              {item.value}
            </text>
            <text transform={`translate(${x0 + w / 2},${H - B + 14}) rotate(-28)`} textAnchor="end">
              {label}
            </text>
          </g>
        );
      })}
      <path d={line} fill="none" stroke={color("brand-purple")} strokeWidth="2.2" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color("brand-purple")} />
      ))}
    </svg>
  );
}

export function AgingChart({ categories, issues, fixes }: { categories: string[]; issues: number[] | null; fixes: number[] | null }) {
  const W = 640;
  const H = 220;
  const L = 36;
  const R = 12;
  const T = 16;
  const B = 28;
  const series = [
    issues ? { name: "Issues", token: "primary", values: issues } : null,
    fixes ? { name: "Fixes", token: "brand-purple", values: fixes } : null,
  ].filter((row): row is { name: string; token: string; values: number[] } => row != null);
  const totals = categories.map((_, i) => series.reduce((sum, row) => sum + (row.values[i] ?? 0), 0));
  const max = Math.max(4, ...totals);
  const bw = (W - L - R) / categories.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <svg className="dash-chart h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Aging of open issues and fixes">
      {[0, 1, 2, 3, 4].map((k) => {
        const v = Math.round((max / 4) * k);
        return (
          <g key={k}>
            <line className="gridl" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        );
      })}
      {categories.map((category, i) => {
        let acc = 0;
        const x0 = L + i * bw + bw * 0.22;
        const w = bw * 0.56;
        return (
          <g key={category}>
            {series.map((row) => {
              const v = row.values[i] ?? 0;
              if (!v) return null;
              const block = (
                <rect key={row.name} x={x0} y={y(acc + v)} width={w} height={Math.max(0, y(acc) - y(acc + v))} rx="2" fill={color(row.token)} opacity="0.9">
                  <title>{`${row.name} · ${category}: ${v}`}</title>
                </rect>
              );
              acc += v;
              return block;
            })}
            <text className="axis" x={x0 + w / 2} y={y(acc) - 5} textAnchor="middle">
              {acc}
            </text>
            <text x={x0 + w / 2} y={H - 8} textAnchor="middle">
              {category}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PlantChart({
  groups,
  series,
}: {
  groups: string[];
  series: { name: string; token: string; values: (number | null)[] }[];
}) {
  const W = 640;
  const H = 230;
  const L = 36;
  const R = 12;
  const T = 16;
  const B = 32;
  const numbers = series.flatMap((row) => row.values.map((v) => v ?? 0));
  const max = Math.max(4, ...numbers);
  const gw = (W - L - R) / Math.max(groups.length, 1);
  const bw = (gw * 0.72) / Math.max(series.length, 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <svg className="dash-chart h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Comparison across plants">
      {[0, 1, 2, 3, 4].map((k) => {
        const v = Math.round((max / 4) * k);
        return (
          <g key={k}>
            <line className="gridl" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        );
      })}
      {groups.map((group, gi) => (
        <g key={group}>
          {series.map((row, si) => {
            const v = row.values[gi] ?? 0;
            const x0 = L + gi * gw + gw * 0.14 + si * bw;
            return (
              <g key={row.name}>
                <rect x={x0} y={y(v)} width={Math.max(0, bw - 3)} height={Math.max(0, y(0) - y(v))} rx="3" fill={color(row.token)}>
                  <title>{`${group} · ${row.name}: ${row.values[gi] == null ? "not available" : v}`}</title>
                </rect>
                {row.values[gi] != null && (
                  <text x={x0 + (bw - 3) / 2} y={y(v) - 4} textAnchor="middle" fontSize="9">
                    {v}
                  </text>
                )}
              </g>
            );
          })}
          <text x={L + gi * gw + gw / 2} y={H - 10} textAnchor="middle" fill={color("foreground")}>
            {group}
          </text>
        </g>
      ))}
    </svg>
  );
}
