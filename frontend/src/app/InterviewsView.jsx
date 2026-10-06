import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, History, Mic, PenLine, Search } from 'lucide-react';
import { Button, Badge, Input, Skeleton } from '../components/ui';
import { PageHeader, Section, EmptyState, ObjectCard, FilterBar, StateScreen } from '../components/primitives';
import { MonoBar } from '../components/charts';
import { listInterviews, summarise, stageLabel, STAGES } from '../lib/interviews';
import { navigate } from '../lib/route';
import { cn, relDate } from '../lib/utils';

// The full practice history. Filterable by round and searchable by role, because
// a candidate with thirty rounds does not scroll to find the one they want.

function scoreTone(score) {
  if (score == null) return 'text-muted-foreground';
  if (score >= 75) return 'text-good';
  if (score >= 55) return 'text-developing';
  return 'text-weak';
}

export default function InterviewsView() {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [stage, setStage] = useState('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      setRows(await listInterviews());
      setError('');
      setState('ready');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => summarise(rows), [rows]);

  const counts = useMemo(() => {
    const out = { all: rows.length };
    for (const row of rows) {
      const key = row.stage || 'full';
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (stage !== 'all' && (row.stage || 'full') !== stage) return false;
      if (!q) return true;
      return `${row.target_role || ''} ${stageLabel(row.stage)} ${row.session_id}`.toLowerCase().includes(q);
    });
  }, [rows, stage, query]);

  if (state === 'error') {
    return (
      <StateScreen
        tone="error"
        title="Could not load your interviews"
        message={error}
        primary={<Button onClick={load}>Try again</Button>}
      />
    );
  }

  return (
    <div className="space-y-2">
      <PageHeader
        title="Your interviews"
        description="Every round you have run, newest first."
        action={<Button onClick={() => navigate('/app/practice')}>Start an interview</Button>}
      />

      {state === 'loading' ? <Skeleton className="h-64 w-full" /> : null}

      {state === 'ready' && !rows.length ? (
        <EmptyState
          icon={History}
          title="No interviews yet"
          message="Once you finish a round it is kept here with its score and report."
          action={<Button onClick={() => navigate('/app/practice')}>Start your first round</Button>}
        />
      ) : null}

      {state === 'ready' && rows.length ? (
        <>
          <Section title="By stage" description="How many rounds, and how they scored." className="pt-0">
            <div className="space-y-2">
              {stats.byStage
                .filter((s) => s.count > 0)
                .map((s) => (
                  <MonoBar
                    key={s.id}
                    label={s.label}
                    sub={`${s.count} round${s.count === 1 ? '' : 's'}`}
                    value={s.average == null ? 0 : s.average}
                    frac={(s.average == null ? 0 : s.average) / 100}
                    fmt={(v) => (s.average == null ? '—' : Math.round(v))}
                  />
                ))}
            </div>
          </Section>

          <Section title="All rounds">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <FilterBar
                value={stage}
                onChange={setStage}
                options={[
                  { value: 'all', label: 'All', count: counts.all },
                  ...rows
                    .filter((r) => r.stage)
                    .map((r) => r.stage)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .map((v) => ({ value: v, label: stageLabel(v), count: counts[v] || 0 })),
                  ...(counts.full ? [{ value: 'full', label: 'Full mock', count: counts.full }] : []),
                ]}
              />
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by role"
                  className="w-56 pl-9"
                />
              </div>
            </div>

            {filtered.length ? (
              <ObjectCard className="overflow-hidden">
                {filtered.map((row) => {
                  const score = Number.isFinite(Number(row.overall_score)) ? Number(row.overall_score) : null;
                  return (
                    <button
                      key={row.id}
                      onClick={() => navigate('/app/interviews/' + row.id)}
                      className="flex min-h-[76px] w-full flex-wrap items-center justify-between gap-4 border-t border-line px-7 text-left transition-colors hover:bg-deep/50"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="display truncate text-[24px] leading-tight">{stageLabel(row.stage)}</span>
                          {row.status === 'live' ? <Badge variant="developing">In progress</Badge> : null}
                          {row.voice_mode ? (
                            <Mic className="h-3.5 w-3.5 text-muted-foreground" aria-label="Answered by voice" />
                          ) : (
                            <PenLine className="h-3.5 w-3.5 text-muted-foreground" aria-label="Answered by keyboard" />
                          )}
                        </div>
                        <p className="mono mt-1 text-[15px] text-mute">
                          {relDate(row.started_at)} · {row.answer_count || 0} answer
                          {(row.answer_count || 0) === 1 ? '' : 's'}
                          {row.target_role ? ` · ${row.target_role}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn('display text-[34px] leading-none', scoreTone(score))}>
                          {score == null ? '—' : Math.round(score)}
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </div>
                    </button>
                  );
                })}
              </ObjectCard>
            ) : (
              <p className="text-sm text-muted-foreground">No rounds match that filter.</p>
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
