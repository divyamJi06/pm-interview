import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { Button, Card, CardContent } from './ui';

// ---------------------------------------------------------------------------
// Page-level building blocks for the redesign.
//
// The old UI put almost every section inside a bordered Card, which made every
// page read as a wall of identical boxes. These primitives make the opposite
// choice easy to express: a Page owns its hierarchy, a Section is a plain block
// with a heading, and a Card is reserved for things that are genuinely objects
// (an interview, a candidate, a primary action).
// ---------------------------------------------------------------------------

export function PageHeader({ title, description, action, children, className }) {
  return (
    <div className={cn('mb-8 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0 space-y-2">
        <h1 className="display text-[30px] leading-[1.1] md:text-[34px]">{title}</h1>
        {description && <p className="max-w-2xl text-[18px] text-mute">{description}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

// A titled block that deliberately has no border or background. Use this for
// explanatory text, reports, lists, and analytics groupings.
export function Section({ title, description, action, className, bodyClassName, children }) {
  return (
    <section className={cn('py-8', className)}>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            {title && <h2 className="kicker">{title}</h2>}
            {description && <p className="text-[18px] text-mute">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Divider({ className }) {
  return <div className={cn('h-px w-full bg-line', className)} />;
}

// The film's kv row: a mono key and a serif value on one line.
export function KeyValue({ label, children, className }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-6 py-4', className)}>
      <div className="kicker">{label}</div>
      <div className="display text-[24px] leading-tight">{children}</div>
    </div>
  );
}

// A single horizontal bar, used for profile completion and stage progress.
export function Meter({ value, max = 100, label, className }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <div className="flex items-center justify-between text-[15px]">
          <span className="text-mute">{label}</span>
          <span className="mono text-mute">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-3 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Horizontal step indicator for the practice setup wizard and onboarding.
export function Stepper({ steps, current, className }) {
  return (
    <ol className={cn('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                'mono inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px]',
                state === 'done' && 'bg-ink text-paper dark:bg-ink dark:text-ground',
                state === 'current' && 'border border-ink text-ink',
                state === 'todo' && 'border border-line text-mute'
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                'text-[15px]',
                state === 'current' ? 'text-ink' : 'text-mute'
              )}
            >
              {s}
            </span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

// Small segmented filter used by the interview history list. The old pages
// used a full "sub-tab" bar for a one-line filter, which consumed the same weight
// as primary navigation.
export function FilterBar({ options, value, onChange, className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'mono rounded-full border px-4 py-2 text-[14px] transition-colors',
              active
                ? 'border-ink text-ink'
                : 'border-line text-mute hover:text-ink'
            )}
          >
            {o.label}
            {o.count != null && <span className="ml-2 text-mute">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Progressive disclosure. The internal session debugger (cost, tokens, latency,
// timeline, model calls, prompts, raw outputs) stays available but no longer
// dominates a page aimed at a candidate.
export function Disclosure({ summary, children, defaultOpen = false, className }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('border-t border-line pt-4', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mono flex w-full items-center justify-between py-1 text-left text-[14px] text-mute transition-colors hover:text-ink"
      >
        {summary}
        <span className="text-mute">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="pt-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dedicated state screens.
//
// Previously an expired link, a closed role, a missing permission and a network
// blip all rendered as a small bordered error card inside an otherwise normal
// page. Each of these is now a real screen with its own heading and one primary
// action, so the candidate knows what happened and what to do next.
// ---------------------------------------------------------------------------
export function StateScreen({ icon: Icon, tone = 'neutral', title, message, primary, secondary, className }) {
  const toneClass =
    tone === 'error'
      ? 'text-weak'
      : tone === 'success'
      ? 'text-good'
      : tone === 'pending'
      ? 'text-developing'
      : 'text-muted-foreground';
  return (
    <div className={cn('mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center', className)}>
      {Icon && <Icon className={cn('mb-5 h-8 w-8', toneClass)} aria-hidden="true" />}
      <h1 className="display text-[28px] leading-tight">{title}</h1>
      {message && <p className="mt-2 text-[15px] text-mute">{message}</p>}
      {(primary || secondary) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {primary}
          {secondary}
        </div>
      )}
    </div>
  );
}

// Empty states for lists. Distinct from StateScreen: the page itself loaded
// fine, there is simply nothing in it yet.
export function EmptyState({ icon: Icon, title, message, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line px-6 py-16 text-center', className)}>
      {Icon && <Icon className="mb-4 h-6 w-6 text-mute" aria-hidden="true" />}
      <p className="display text-[22px]">{title}</p>
      {message && <p className="mt-2 max-w-sm text-[15px] text-mute">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Card wrapper for things that are genuinely objects.
export function ObjectCard({ className, ...props }) {
  return <Card className={cn('shadow-none', className)} {...props} />;
}

export function ObjectCardBody({ className, ...props }) {
  return <CardContent className={cn('space-y-3', className)} {...props} />;
}

export { Button };
