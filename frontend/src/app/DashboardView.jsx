import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, History, Mic, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Button, Badge, Skeleton } from '../components/ui';
import { PageHeader, Section, EmptyState, ObjectCard, KeyValue } from '../components/primitives';
import { MonoBar } from '../components/charts';
import { useAuth } from './authContext';
import { listInterviews, summarise, stageLabel, STAGES } from '../lib/interviews';
import { navigate } from '../lib/route';
import { cn, relDate } from '../lib/utils';

// The candidate's home. Two jobs: say what their last practice session changed,
// and put one click between them and the next round.
//
// A brand new candidate sees zeros, not a broken chart. Every analytics block
// has an explicit empty state, because "no data yet" and "the query failed" look
// identical otherwise.

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function scoreTone(score) {
  if (score == null) return 'text-muted-foreground';
  if (score >= 75) return 'text-good';
  if (score >= 55) return 'text-developing';
  return 'text-weak';
}

function Trend({ value }) {
  if (value == null) return null;
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', up ? 'text-good' : 'text-weak')}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {up ? '+' : ''}
      {Math.round(value)}
    </span>
  );
}

function InterviewRow({ row }) {
  const score = Number.isFinite(Number(row.overall_score)) ? Number(row.overall_score) : null;
  return (
    <button
      onClick={() => navigate('/app/interviews/' + row.id)}
      className="flex min-h-[76px] w-full flex-wrap items-center justify-between gap-4 border-t border-line px-7 text-left transition-colors hover:bg-deep/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="display truncate text-[24px] leading-tight">{stageLabel(row.stage)}</span>
          {row.status === 'live' ? <Badge variant="developing">In progress</Badge> : null}
          {row.voice_mode ? <Mic className="h-4 w-4 text-mute" aria-label="Voice round" /> : null}
        </div>
        <p className="mono mt-1 text-[15px] text-mute">
          {relDate(row.started_at)} · {row.answer_count || 0} answer{(row.answer_count || 0) === 1 ? '' : 's'}
          {row.feedback_mode === 'simulation' ? ' · simulation mode' : ''}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <span className={cn('display text-[34px] leading-none', scoreTone(score))}>{score == null ? '—' : Math.round(score)}</span>
        <ArrowRight className="h-4 w-4 text-mute" aria-hidden="true" />
      </div>
    </button>
  );
}

export default function DashboardView({ onStartPractice }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const list = await listInterviews();
      setRows(list);
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
  const isNew = stats.total === 0;
  const firstName = (profile?.full_name || '').split(' ')[0];

  return (
    <div className="space-y-2">
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}.` : `${greeting()}.`}
        description="Your last rounds, what they scored, and what to practise next."
        action={
          <Button size="lg" className="w-[238px]" onClick={onStartPractice || (() => navigate('/app/practice'))}>
            Start an interview <ArrowRight className="h-4 w-4" />
          </Button>
        }
      />

      {state === 'loading' ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="inset px-6 py-4 text-[17px] text-destructive">
          Could not load your history: {error}
        </div>
      ) : null}

      {state === 'ready' && isNew ? (
        <>
          <EmptyState
            icon={Sparkles}
            title="No interviews yet"
            message="Run your first round and this page fills in: scores per stage, your strongest and weakest dimension, and every past interview."
            action={<Button onClick={onStartPractice || (() => navigate('/app/practice'))}>Start an interview</Button>}
          />
          <StageShortcuts />
        </>
      ) : null}

      {state === 'ready' && !isNew ? (
        <>
          <Section title="Overview" className="pt-0">
            <div className="inset grid divide-line px-7 py-2 sm:grid-cols-2 sm:divide-y lg:grid-cols-4 lg:divide-y-0">
              <KeyValue className="flex-col items-start gap-1 px-0 py-5 lg:border-r lg:border-line lg:px-6 lg:first:pl-0" label="Interviews">{stats.total}</KeyValue>
              <KeyValue className="flex-col items-start gap-1 px-0 py-5 lg:border-r lg:border-line lg:px-6" label="Completed">{stats.completed}</KeyValue>
              <KeyValue className="flex-col items-start gap-1 px-0 py-5 lg:border-r lg:border-line lg:px-6" label="Average score">
                <span className={scoreTone(stats.overall)}>
                  {stats.overall == null ? '—' : Math.round(stats.overall)}
                </span>
              </KeyValue>
              <KeyValue className="flex-col items-start gap-1 px-0 py-5 lg:px-6" label="Last practice">{stats.lastAt ? relDate(stats.lastAt) : '—'}</KeyValue>
            </div>
            {stats.strongest || stats.weakest ? (
              <p className="mono mt-6 text-[17px] text-mute">
                {stats.strongest ? (
                  <>
                    strongest {stats.strongest.name} at {Math.round(stats.strongest.average)}
                  </>
                ) : null}
                {stats.strongest && stats.weakest ? ' · ' : null}
                {stats.weakest && stats.weakest.name !== stats.strongest?.name ? (
                  <>
                    weakest {stats.weakest.name} at {Math.round(stats.weakest.average)}
                  </>
                ) : null}
              </p>
            ) : null}
          </Section>

          <Section title="By stage" description="Average score for every round you have completed.">
            <div className="inset divide-y divide-line px-7 py-1">
              {stats.byStage.map((s) => (
                <div key={s.id} className="py-4">
                  <MonoBar
                    label={s.label}
                    sub={s.count ? `${s.count} round${s.count === 1 ? '' : 's'}` : 'not practised'}
                    value={s.average == null ? 0 : s.average}
                    frac={(s.average == null ? 0 : s.average) / 100}
                    fmt={(v) => (s.average == null ? '—' : Math.round(v))}
                    weakest={!!stats.weakest && s.id === stats.weakest.id && s.average != null}
                  />
                </div>
              ))}
            </div>
            <p className="mt-4 text-[17px] text-mute">
              A stage with no rounds shows a dash. Practise the one you would least like to be asked on.
            </p>
          </Section>

          <Section
            title="Your interviews"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/app/interviews')}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <ObjectCard className="overflow-hidden">
              {rows.slice(0, 6).map((row) => (
                <InterviewRow key={row.id} row={row} />
              ))}
            </ObjectCard>
          </Section>
        </>
      ) : null}

      {state === 'ready' && !isNew ? <StageShortcuts /> : null}
    </div>
  );
}

// The five rounds the candidate is told to pick from, always one click away.
// Drawn from the same list the practice setup and the analytics use, so a stage
// cannot exist on this page and be missing from the wizard.
function StageShortcuts() {
  return (
    <Section title="Practise a round" description="Pick the one you are weakest at.">
      <div className="inset divide-y divide-line px-7">
        {STAGES.slice(0, 6).map((stage) => (
          <button
            key={stage.id}
            onClick={() => navigate('/app/practice?stage=' + stage.id)}
            className="group flex w-full items-center gap-6 py-5 text-left"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="display text-[24px] leading-tight">{stage.label}</span>
              <span className="text-[17px] text-mute">{stage.blurb}</span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-mute transition-transform group-hover:translate-x-1" />
          </button>
        ))}
      </div>
      <Button variant="ghost" className="mt-8" onClick={() => navigate('/app/interviews')}>
        <History className="h-4 w-4" /> All interviews
      </Button>
    </Section>
  );
}
