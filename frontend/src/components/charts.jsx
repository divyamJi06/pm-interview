import React from 'react';

// The film's bar row: a fixed-width muted label, a hairline track that fills in
// ink, and the number set in mono on the right. No shadows, no round chips.
export function MonoBar({ label, sub, value, frac, fmt, weakest }) {
  return (
    <div className="flex items-center gap-5">
      <span className="w-56 shrink-0 truncate text-[22px] text-ink">
        {label}
        {sub ? <span className="mono ml-3 text-[15px] text-mute">{sub}</span> : null}
      </span>
      <span className="h-4 flex-1 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-ink transition-all"
          style={{ width: `${Math.max(2, Math.min(100, frac * 100))}%` }}
        />
      </span>
      <span className="mono w-20 shrink-0 text-right text-[20px] text-mute">{fmt(value)}</span>
      {weakest ? (
        <span className="mono shrink-0 rounded-full bg-brass px-3 py-1 text-[13px] text-paper">weakest</span>
      ) : (
        <span className="w-[74px] shrink-0" />
      )}
    </div>
  );
}

// The film's key/value chip. Mono, hairline border, tone in the value only.
export function Chip({ label, value, tone }) {
  return (
    <span className="mono inline-flex items-center gap-2 rounded-full border border-line bg-deep/60 px-3 py-1.5 text-[13px] text-mute">
      {label}
      <b className={tone ? `text-${tone}` : 'text-ink'}>{String(value)}</b>
    </span>
  );
}

// The funnel reads as rows of ink, tallest first, the same way the film's plan
// rows read: a solid ink block whose length is the value, with the count in mono.
export function Funnel({ stages }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="flex w-full flex-col gap-2">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-5">
          <span className="w-36 shrink-0 text-[14px] text-mute">{s.label}</span>
          <span
            className="h-7 rounded-sm bg-ink transition-all"
            style={{ width: `${s.value === 0 ? 2 : Math.max(6, (s.value / max) * 100)}%` }}
          />
          <span className="mono w-10 text-right text-ink">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// Three ink segments. Good is green, developing is brass, weak is alert, and the
// proportions are the only thing carrying meaning, so there is no chrome.
export function VerdictSpark({ strong, developing, weak }) {
  const total = strong + developing + weak;
  if (!total) return <span className="text-[13px] text-mute">no graded answers</span>;
  const p = (n) => Math.round((n / total) * 100);
  return (
    <div className="flex h-3 w-36 overflow-hidden rounded-full">
      <span className="h-full bg-good" style={{ width: p(strong) + '%' }} />
      <span className="h-full bg-developing" style={{ width: p(developing) + '%' }} />
      <span className="h-full bg-weak" style={{ width: p(weak) + '%' }} />
    </div>
  );
}