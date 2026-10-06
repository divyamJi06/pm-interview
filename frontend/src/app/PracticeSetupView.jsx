import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Mic, PenLine, PlayCircle } from 'lucide-react';
import { Button } from '../components/ui';
import { PageHeader, Section, KeyValue, ObjectCard, EmptyState } from '../components/primitives';
import { useAuth } from './authContext';
import { usePrep } from './prepContext';
import { STAGES, stageLabel } from '../lib/interviews';
import { api } from '../lib/utils';
import { navigate, usePath } from '../lib/route';
import { cn } from '../lib/utils';

// Setup for one interview. Three decisions and it starts: which round, how you
// answer, and whether the keys are in place.
//
// The keys are edited on the profile page, not here. This screen only says
// whether they are present, because a key form in the middle of a start flow is
// where people fat-finger a secret.

function useQueryStage() {
  const path = usePath();
  return useMemo(() => new URLSearchParams(path.split('?')[1] || '').get('stage') || '', [path]);
}

export default function PracticeSetupView() {
  const { profile, user, keys } = useAuth();
  const { setPreset } = usePrep();
  const queryStage = useQueryStage();

  const [stage, setStage] = useState(queryStage || '');
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('pm-voice-mode') !== 'off');
  const [live, setLive] = useState([]);
  const [serverStages, setServerStages] = useState([]);

  // The dashboard and the picker both read the stage list from lib/interviews,
  // but the engine is the authority on what it can actually run. If the two ever
  // disagree, the engine's list wins and the unusable option disappears.
  useEffect(() => {
    (async () => {
      const [sessions, stages] = await Promise.all([
        api('GET', '/api/sessions' + (user?.id ? '?userId=' + encodeURIComponent(user.id) : '')).catch(() => ({ sessions: [] })),
        api('GET', '/api/stages').catch(() => ({ stages: [] })),
      ]);
      setLive(sessions.sessions || []);
      const names = (stages.stages || []).map((s) => s.name).filter((n) => n !== 'greeting');
      setServerStages(names);
    })();
  }, [user]);

  const available = useMemo(() => {
    if (!serverStages.length) return STAGES;
    return STAGES.filter((s) => serverStages.includes(s.id));
  }, [serverStages]);

  const needsLlmKey = !keys.llm;
  const needsSttKey = voiceMode && !keys.stt && !keys.llm;

  const start = useCallback(() => {
    setPreset({
      trackId: 'pm',
      stage,
      voiceMode,
      autoStart: true,
    });
    navigate('/app/practice/interview');
  }, [stage, voiceMode, setPreset]);

  const resume = useCallback(
    (sessionId) => {
      setPreset({ sessionId, voiceMode, autoStart: true });
      navigate('/app/practice/interview');
    },
    [setPreset, voiceMode]
  );

  return (
    <div className="mx-auto w-full">
      <PageHeader
        title="Start an interview"
        description="Pick the round you want to work on. Everything else is already set from your profile."
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate('/app')}>
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Button>
        }
      />

      {live.length ? (
        <Section title="Unfinished rounds" className="pt-0">
          <div className="space-y-3">
            {live.map((s) => (
              <ObjectCard key={s.sessionId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
                <div className="min-w-0">
                  <div className="display text-[22px] leading-tight">
                    {stageLabel(s.practiceStage) || 'Unfinished round'}
                  </div>
                  <p className="mono mt-1 text-[14px] text-mute">
                    {s.answers} answer{s.answers === 1 ? '' : 's'} · {new Date(s.startedAt).toLocaleString()}
                  </p>
                </div>
                <Button variant="outline" onClick={() => resume(s.sessionId)}>
                  <PlayCircle className="h-4 w-4" /> Resume
                </Button>
              </ObjectCard>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Which round?">
        <div className="inset divide-y divide-line px-7 py-1">
          {available.map((s) => {
            const active = stage === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => setStage(active ? '' : s.id)}
                className={cn(
                  'flex w-full items-center gap-4 py-4 text-left transition-colors',
                  active ? 'text-ink' : 'text-mute hover:text-ink'
                )}
              >
                <span
                  className={cn(
                    'relative flex h-[22px] w-[22px] flex-none rounded-full border-[1.5px]',
                    active ? 'border-ink' : 'border-line'
                  )}
                >
                  <span
                    className={cn(
                      'absolute inset-1 rounded-full bg-ink transition-transform',
                      active ? 'scale-100' : 'scale-0'
                    )}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[22px] leading-tight">{s.label}</span>
                  <span className="text-[16px] text-mute">{s.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="How will you answer?">
        <div className="flex gap-2">
          {[
            { value: false, label: 'Type', icon: PenLine, hint: 'Questions on screen, you type.' },
            { value: true, label: 'Speak', icon: Mic, hint: 'Questions read aloud, you answer into the mic.' },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => {
                setVoiceMode(o.value);
                localStorage.setItem('pm-voice-mode', o.value ? 'on' : 'off');
              }}
              className={cn(
                'mono inline-flex items-center gap-2 rounded-full border bg-card px-[22px] py-[13px] text-[18px] transition-colors',
                voiceMode === o.value ? 'border-ink text-ink' : 'border-line text-mute hover:text-ink'
              )}
            >
              <o.icon className="h-3.5 w-3.5" /> {o.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-[17px] text-mute">
          {voiceMode
            ? 'Your voice answers are transcribed with Cohere, then judged as spoken.'
            : 'Typing is fine for estimation and case study; behavioural and design land better out loud.'}
        </p>
      </Section>

      <Section title="Feedback">
        <div className="inset px-7 py-6">
          <p className="text-[18px] text-mute">
            You answer the whole round without seeing a verdict. Every answer is judged and scored, and the
            full feedback plus your report is released when the round ends.
          </p>
        </div>
      </Section>

      {needsLlmKey || needsSttKey ? (
        <Section title="Before you start">
          <EmptyState
            icon={KeyRound}
            title="Add your Cohere key"
            message={
              needsLlmKey
                ? 'The interviewer runs on your own key, so your practice is billed to you and nothing is shared.'
                : 'Voice answers need a Cohere key for transcription.'
            }
            action={<Button onClick={() => navigate('/app/profile')}>Add it in your profile</Button>}
          />
        </Section>
      ) : null}

      <Section title="Ready">
        <div className="inset divide-y divide-line px-7 py-1">
          <KeyValue label="Round">{stageLabel(stage) || 'Pick a round above'}</KeyValue>
          <KeyValue label="Answering">{voiceMode ? 'Voice' : 'Keyboard'}</KeyValue>
          <KeyValue label="Feedback">Released when the round ends</KeyValue>
          <KeyValue label="Interviewing for">{profile?.target_role || 'Not set'}</KeyValue>
        </div>
      </Section>

      <div className="mt-8 flex items-center justify-end gap-4">
        <Button variant="ghost" onClick={() => navigate('/app')}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="w-[238px]"
          disabled={needsLlmKey || needsSttKey || !stage}
          onClick={start}
        >
          Start interview <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
