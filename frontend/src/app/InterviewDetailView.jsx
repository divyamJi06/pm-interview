import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Mic, PenLine, PlayCircle } from 'lucide-react';
import { Button, Skeleton, Badge } from '../components/ui';
import { PageHeader, Section, StateScreen, KeyValue, Divider } from '../components/primitives';
import { MonoBar } from '../components/charts';
import ReportBody from './ReportBody';
import { supabaseConfigured } from '../lib/supabase';
import { listInterviews, getReport, scoreFromReport, countsFromReport, stageLabel, listTurns } from '../lib/interviews';
import { api, readLocal, dateNice } from '../lib/utils';
import { navigate } from '../lib/route';

// One past interview. The row and the report come from Supabase, so this page
// works for a round run weeks ago on a machine that has since been rebuilt.
//
// The one exception is a round still marked "live": its report has not been
// written yet, so it polls the engine the same way the interview view does.

export default function InterviewDetailView({ interviewId }) {
  const [row, setRow] = useState(null);
  const [report, setReport] = useState(null);
  const [reportState, setReportState] = useState('');
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clipUrl, setClipUrl] = useState('');

  const load = useCallback(async () => {
    if (!interviewId) return;
    setLoading(true);
    try {
      const rows = await listInterviews();
      const found = rows.find((r) => r.id === interviewId) || null;
      setRow(found);
      if (found) {
        const saved = await getReport(found.id);
        if (saved && saved.report) {
          setReport(saved.report);
          setReportState('final_report');
        }
        // The stored question and answer sequence. Independent of the report, so
        // a live round still shows what has been said so far.
        setTurns(await listTurns(found.id).catch(() => []));
      }
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    load();
  }, [load]);

  // A live round has no stored report yet. Poll the engine, then fall back to
  // Supabase so a report written by the interview view is picked up too.
  useEffect(() => {
    if (!row || row.status !== 'live' || !row.session_id) return undefined;
    let cancelled = false;
    let tries = 0;
    const poll = async () => {
      if (cancelled) return;
      try {
        const d = await api('GET', '/api/report/' + encodeURIComponent(row.session_id));
        if (cancelled) return;
        setReportState(d.state || '');
        if (d.state === 'final_report') {
          setReport(d);
          return;
        }
      } catch (_) {}
      tries += 1;
      if (tries > 20) return;
      setTimeout(poll, 3000);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [row]);

  useEffect(() => {
    if (!row || !row.session_id) return;
    const token = readLocal('rec-' + row.session_id, '');
    setClipUrl(
      token ? `/api/recordings/${encodeURIComponent(row.session_id)}/clip?token=${encodeURIComponent(token)}` : ''
    );
  }, [row]);

  const scores = useMemo(() => scoreFromReport(report), [report]);
  const counts = useMemo(() => countsFromReport(report), [report]);
  const dimensions = useMemo(
    () => Object.entries(scores.dimensions || {}).sort((a, b) => b[1] - a[1]),
    [scores]
  );

  if (loading) return <Skeleton className="h-72 w-full" />;

  if (error) {
    return (
      <StateScreen
        tone="error"
        title="Could not open this interview"
        message={error}
        primary={<Button onClick={() => navigate('/app/interviews')}>Back to your interviews</Button>}
      />
    );
  }

  if (!row) {
    return (
      <StateScreen
        title="Interview not found"
        message={supabaseConfigured ? 'That interview is not in your history.' : 'Sign in to see your interviews.'}
        primary={<Button onClick={() => navigate('/app/interviews')}>Back to your interviews</Button>}
      />
    );
  }

  return (
    <div className="mx-auto w-full">
      <div className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/interviews')}>
          <ArrowLeft className="h-4 w-4" /> Your interviews
        </Button>
      </div>

      <PageHeader
        title={stageLabel(row.stage)}
        description={`${dateNice(row.started_at)} · ${row.answer_count || counts.answers} answer${
          (row.answer_count || counts.answers) === 1 ? '' : 's'
        }`}
        action={
          row.status === 'live' ? (
            <Button onClick={() => navigate('/app/practice/interview?session=' + row.session_id)}>
              <PlayCircle className="h-4 w-4" /> Resume this round
            </Button>
          ) : (
            <Button variant="outline" onClick={() => navigate('/app/practice?stage=' + (row.stage || ''))}>
              Practise this round again
            </Button>
          )
        }
      />

      <div className="mono mb-8 flex flex-wrap items-center gap-4 text-[15px] text-mute">
        {row.status === 'live' ? <Badge variant="developing">In progress</Badge> : null}
        <span className="inline-flex items-center gap-1">
          {row.voice_mode ? <Mic className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
          {row.voice_mode ? 'Answered by voice' : 'Answered by keyboard'}
        </span>
        <span>· Feedback released when the round ends</span>
        {row.target_role ? <span>· {row.target_role}</span> : null}
      </div>

      {scores.overall != null ? (
        <Section title="Score" className="pt-0">
          <div className="grid gap-8 sm:grid-cols-3">
            <KeyValue label="Overall">
              <span className="display text-[30px] leading-none">{scores.overall}</span>
              <span className="text-xs text-muted-foreground"> / 100</span>
            </KeyValue>
            <KeyValue label="Answers scored">{scores.answersScored}</KeyValue>
            <KeyValue label="Questions asked">{counts.questions || row.question_count || 0}</KeyValue>
          </div>

          {dimensions.length ? (
            <>
              <Divider className="my-8" />
              <div className="space-y-2">
                {dimensions.map(([dim, value]) => (
                  <MonoBar key={dim} label={dim.replace(/_/g, ' ')} value={value} frac={value / 100} fmt={(v) => Math.round(v)} />
                ))}
              </div>
            </>
          ) : null}
        </Section>
      ) : null}

      {turns.length ? (
        <Section title="Transcript">
          <div className="space-y-3">
            {turns.map((t) => (
              <div
                key={t.id}
                className={
                  t.kind === 'question'
                    ? 'text-mute'
                    : t.kind === 'answer'
                      ? 'text-ink'
                      : t.kind === 'judge'
                        ? 'inset px-5 py-4'
                        : 'inset px-5 py-4'
                }
              >
                {t.kind === 'question' ? (
                  <p className="text-[17px]">
                    <span className="mono mr-2 text-[14px] uppercase text-mute">
                      {t.is_follow_up ? 'Follow-up' : 'Interviewer'}
                    </span>
                    {t.text}
                  </p>
                ) : null}
                {t.kind === 'answer' ? <p className="text-[17px]">{t.text}</p> : null}
                {t.kind === 'clarify' ? (
                  <p className="text-[15px]">
                    <span className="mono mr-2 text-[14px] uppercase text-mute">Q</span>
                    {(t.detail || {}).candidate_question || ''}
                    <br />
                    <span className="mono mr-2 text-[14px] uppercase text-mute">A</span>
                    {(t.detail || {}).interviewer_answer || ''}
                  </p>
                ) : null}
                {t.kind === 'judge' && row.status !== 'live' ? (
                  <>
                    <div className="mono mb-1 text-[14px] uppercase text-mute">
                      Judge · {(t.detail || {}).verdict || 'scored'}
                    </div>
                    <p className="text-[16px]">{(t.detail || {}).summary || ''}</p>
                  </>
                ) : null}
                {t.kind === 'stage_verdict' ? (
                  <>
                    <div className="mono mb-1 text-[14px] uppercase text-mute">Stage verdict</div>
                    <p className="text-[16px]">{((t.detail || {}).verdict || {}).summary || ''}</p>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {report ? (
        <ReportBody payload={report} />
      ) : (
        <Section title="Report">
          <p className="text-[17px] text-mute">
            {reportState === 'analyzing'
              ? 'Your report is still being written. This page fills in when it is ready.'
              : row.status === 'live'
                ? 'This round is still running. The report appears once it ends.'
                : 'No report was stored for this round.'}
          </p>
        </Section>
      )}

      {clipUrl ? (
        <Section title="Recording">
          <video src={clipUrl} controls playsInline className="aspect-video w-full rounded-[14px] bg-deep" />
        </Section>
      ) : null}
    </div>
  );
}
