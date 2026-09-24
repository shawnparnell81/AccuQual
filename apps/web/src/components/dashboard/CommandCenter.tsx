import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity } from "lucide-react";
import type { Tone } from "./kit";

const TONE_VAR: Record<Tone, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
  info: "var(--info)",
};
const toneHsl = (tone: Tone) => `hsl(${TONE_VAR[tone]})`;

export interface StatusCell {
  key: string;
  label: string;
  state: string;
  detail: string;
  tone: Tone;
  href?: string;
}

/** One glowing status light per area, with a one-word state. */
export function StatusBoard({ cells }: { cells: StatusCell[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cells.map((cell, i) => {
        const body = (
          <>
            <div className="relative flex items-center gap-2">
              <span className="led" style={{ ["--tone" as string]: TONE_VAR[cell.tone] }} />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{cell.label}</span>
            </div>
            <p className="relative mt-2 text-lg font-semibold leading-tight" style={{ color: toneHsl(cell.tone) }}>
              {cell.state}
            </p>
            <p className="relative text-xs text-muted-foreground">{cell.detail}</p>
          </>
        );
        const cls = "kpi-tile reveal block rounded-xl p-3.5";
        const style = { ["--tone" as string]: TONE_VAR[cell.tone], ["--d" as string]: `${i * 60}ms` } as React.CSSProperties;
        return cell.href ? (
          <Link key={cell.key} to={cell.href} className={cls} style={style}>
            {body}
          </Link>
        ) : (
          <div key={cell.key} className={`${cls} kpi-hover`} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export interface TrendPoint {
  label: string;
  opened: number;
  closed: number;
}

/** Issues and fixes opened vs closed, week by week. */
export function TrendPanel({ data }: { data: TrendPoint[] }) {
  const opened = data.reduce((sum, p) => sum + p.opened, 0);
  const closed = data.reduce((sum, p) => sum + p.closed, 0);
  const opening = "hsl(var(--warning))";
  const closing = "hsl(var(--success))";
  return (
    <div className="h-full rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Opened vs closed</h2>
          <p className="text-xs text-muted-foreground">Issues and fixes, last {data.length} weeks</p>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: opening }}>{opened}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Opened</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums" style={{ color: closing }}>{closed}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Closed</p>
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={data} margin={{ top: 10, right: 6, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="cc-opened" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={opening} stopOpacity={0.45} />
              <stop offset="100%" stopColor={opening} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cc-closed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={closing} stopOpacity={0.45} />
              <stop offset="100%" stopColor={closing} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
            labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          />
          <Area type="monotone" dataKey="opened" name="Opened" stroke={opening} strokeWidth={2.5} fill="url(#cc-opened)" animationDuration={1400} />
          <Area type="monotone" dataKey="closed" name="Closed" stroke={closing} strokeWidth={2.5} fill="url(#cc-closed)" animationDuration={1400} animationBegin={250} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface FeedEvent {
  key: string;
  at: string;
  title: string;
  detail: string;
  tone: Tone;
  href: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

/** What just happened across issues, fixes and stock, newest first. */
export function ActivityFeed({ events }: { events: FeedEvent[] }) {
  return (
    <div className="h-full rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity size={15} className="text-primary" /> Live activity
        </h2>
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className="led" style={{ ["--tone" as string]: "var(--success)", width: 7, height: 7 }} /> Live
        </span>
      </div>
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing has happened yet. New issues, fixes and stock alerts show up here as they happen.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
          {events.map((event, i) => (
            <li key={event.key} className="feed-in relative" style={{ ["--d" as string]: `${i * 70}ms` }}>
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card" style={{ background: toneHsl(event.tone) }} />
              <Link to={event.href} className="block rounded-md px-2 py-1 hover:bg-muted/60">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{event.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(event.at)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{event.detail}</p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
