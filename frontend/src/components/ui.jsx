import React from 'react';
import { cn, VERDICT_CLASS } from '../lib/utils';

export function verdictPill(v) {
  return <span className={`mono ${VERDICT_CLASS[v] || 'text-mute'}`}>{v || '—'}</span>;
}

export function Button({ className, variant = 'default', size = 'default', ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        variant === 'default' && 'mono bg-ink text-paper hover:bg-ink/88 dark:bg-ink dark:text-ground dark:hover:bg-ink/88',
        variant === 'secondary' && 'mono border border-line bg-paper text-mute hover:text-ink',
        variant === 'ghost' && 'text-mute hover:bg-deep hover:text-ink',
        variant === 'outline' && 'border border-ink bg-transparent text-ink hover:bg-ink hover:text-paper',
        variant === 'destructive' && 'mono bg-destructive text-paper hover:bg-destructive/90',
        size === 'default' && 'h-12 px-6 text-[15px]',
        size === 'sm' && 'h-9 px-4 text-[13px]',
        size === 'lg' && 'h-14 px-9 text-[17px]',
        size === 'icon' && 'h-10 w-10',
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }) {
  return (
    <div
      className={cn('rounded-[14px] border border-line bg-card text-card-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col space-y-1 px-7 pt-7', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-7 pb-7', className)} {...props} />;
}

export function Badge({ className, variant = 'default', ...props }) {
  return (
    <span
      className={cn(
        'mono inline-flex items-center rounded-full border px-3 py-1 text-[13px] transition-colors',
        variant === 'default' && 'border-transparent bg-ink text-paper dark:bg-ink dark:text-ground',
        variant === 'secondary' && 'border-transparent bg-deep text-mute',
        variant === 'outline' && 'border-line text-mute',
        variant === 'good' && 'border-good/30 bg-good/8 text-good',
        variant === 'developing' && 'border-developing/35 bg-developing/10 text-developing',
        variant === 'weak' && 'border-weak/30 bg-weak/8 text-weak',
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }) {
  return <label className={cn('kicker block', className)} {...props} />;
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'flex h-12 w-full rounded-[10px] border border-line bg-ground px-4 py-1 text-[15px] transition-colors placeholder:text-mute focus-visible:outline-none focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        'flex min-h-28 w-full rounded-[10px] border border-line bg-ground px-4 py-3 text-[15px] leading-relaxed transition-colors placeholder:text-mute focus-visible:outline-none focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }) {
  return (
    <select
      className={cn(
        'flex h-12 w-full rounded-[10px] border border-line bg-ground px-4 py-1 text-[15px] transition-colors focus-visible:outline-none focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function Separator({ className, ...props }) {
  return <div className={cn('h-px w-full bg-border', className)} {...props} />;
}

export function Tabs({ value, onValueChange, className, children }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child, { value, onValueChange }) : child
      )}
    </div>
  );
}

export function TabsList({ value, onValueChange, className, children }) {
  return (
    <div className={cn('mono inline-flex items-center justify-center rounded-full bg-deep p-1 text-[14px] text-mute', className)}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child, { active: child.props.value === value, onValueChange })
          : child
      )}
    </div>
  );
}

export function TabsTrigger({ active, onValueChange, value, className, children }) {
  return (
    <button
      type="button"
      onClick={() => onValueChange && onValueChange(value)}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        active ? 'bg-paper text-ink' : 'hover:text-ink',
        className
      )}
    >
      {children}
    </button>
  );
}

export function Seg({ value, onChange, options, className }) {
  return (
    <div className={cn('mono inline-flex items-center rounded-full bg-deep p-1 text-[14px] text-mute', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-4 py-2 transition-colors',
            value === o.value ? 'bg-paper text-ink' : 'hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ index, total }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-2 flex-1 rounded-full transition-colors',
            i < index ? 'bg-ink' : i === index ? 'bg-ring' : 'bg-line'
          )}
        />
      ))}
    </div>
  );
}

export function Skeleton({ className, ...props }) {
  return <div className={cn('animate-pulse rounded-[10px] bg-deep', className)} {...props} />;
}