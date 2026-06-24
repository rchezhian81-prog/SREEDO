/*
 * Lightweight, dependency-free charts (no chart library). Themed with the
 * `brand` palette / semantic tokens; crisp at any size.
 */

const DONUT_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#db2777", "#7c3aed", "#0891b2"];

export function EmptyChart({ message = "No data yet" }: { message?: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted">{message}</div>
  );
}

export function BarChart({
  data,
  format = (v: number) => String(v),
}: {
  data: { label: string; value: number }[];
  format?: (v: number) => string;
}) {
  if (!data.length) return <EmptyChart />;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex h-44 items-end gap-2">
        {data.map((d) => (
          <div
            key={d.label}
            className="flex h-full flex-1 items-end"
            title={`${d.label}: ${format(d.value)}`}
          >
            <div
              className="w-full rounded-t-md bg-brand-500/85 transition-all"
              style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {data.map((d) => (
          <div key={d.label} className="flex-1 truncate text-center text-[10px] text-muted" title={d.label}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({
  data,
}: {
  // value is 0..1 (a rate); rendered as a percentage line.
  data: { label: string; value: number }[];
}) {
  if (!data.length) return <EmptyChart />;
  const w = 100;
  const h = 40;
  const n = data.length;
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - Math.max(0, Math.min(1, v)) * h;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${h} L${x(0).toFixed(1)} ${h} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-40 w-full text-brand-500">
        <path d={area} fill="currentColor" opacity={0.1} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        <span>{data[0]?.label}</span>
        {n > 2 ? <span>{data[Math.floor(n / 2)]?.label}</span> : null}
        <span>{data[n - 1]?.label}</span>
      </div>
    </div>
  );
}

export function DonutChart({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <EmptyChart />;
  const r = 16;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 40 40" className="h-32 w-32 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth="6" />
        {data.map((d, i) => {
          const dash = (d.value / total) * circ;
          const seg = (
            <circle
              key={d.label}
              cx="20"
              cy="20"
              r={r}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="6"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-acc}
            />
          );
          acc += dash;
          return seg;
        })}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="capitalize text-ink">{d.label}</span>
            <span className="text-muted">
              {d.value} ({Math.round((d.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
