import React from 'react';
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  Gauge,
  KeyRound,
  Layers,
  MessageSquareQuote,
  Mic,
  Play,
  Sparkles,
  Target,
} from 'lucide-react';
import { Button } from '../components/ui';
import { Section } from '../components/primitives';
import { ThemeToggle } from '../components/Shell';
import { navigate, usePath } from '../lib/route';

// The public front door. Everything a candidate needs to decide whether this is
// worth an hour of their evening, before they are asked for an email address.
//
// The demo video is a placeholder on purpose: drop an mp4 or webm into
// frontend/public and point <DemoVideo> at it. Nothing else has to change.

const FEATURES = [
  {
    icon: Target,
    title: 'Practice one round properly',
    body: 'Estimation, product design, case study, strategy, technical execution or behavioural. Pick the one you are weakest at instead of sitting through a full loop every time.',
  },
  {
    icon: MessageSquareQuote,
    title: 'An interviewer that pushes back',
    body: 'Clarifying questions, follow-ups on vague answers, and a rubric per stage drawn from real loop formats. It will not let you hand-wave a metric.',
  },
  {
    icon: Mic,
    title: 'Answer out loud',
    body: 'Speak your answer and it is transcribed and judged as spoken. Practise the way you actually interview, not the way you type.',
  },
  {
    icon: Gauge,
    title: 'Scored against the rubric',
    body: 'Every answer is scored per dimension — product thinking, execution, prioritisation, communication — with the reasoning shown next to the number.',
  },
  {
    icon: ClipboardList,
    title: 'Coaching, not just a verdict',
    body: 'Each round ends with what to fix, in priority order, phrased as what to do differently in the next interview.',
  },
  {
    icon: BarChart3,
    title: 'Progress you can see',
    body: 'Scores per stage over time, your strongest and weakest dimension, and every past interview kept in one list.',
  },
];

const STEPS = [
  { step: '01', title: 'Create an account', body: 'Email and password. Then your name, phone, target role and resume, so the interviewer knows who it is talking to.' },
  { step: '02', title: 'Add your Cohere key', body: 'The engine runs on your own key, so your practice costs you nothing and your data stays with you. Voice needs a second one.' },
  { step: '03', title: 'Pick a round and go', body: 'Choose the stage, answer by voice or keyboard, and read the score and coaching when it ends.' },
];

export function DemoVideo({ src, poster }) {
  // Placeholder until real footage lands: a framed area with a play affordance
  // rather than a broken <video> element and a browser error message.
  if (!src) {
    return (
      <div className="inset relative flex aspect-video w-full items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-line bg-paper">
            <Play className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium">Demo video goes here</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Drop the file in <code className="font-mono">frontend/public/</code> and pass its path to{' '}
            <code className="font-mono">DemoVideo</code>.
          </p>
        </div>
      </div>
    );
  }
  return (
    <video
      className="aspect-video w-full rounded-xl border bg-black object-cover"
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
    />
  );
}

export default function LandingPage() {
  const path = usePath();
  const isAuth = path === '/login' || path === '/signup';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-line bg-deep">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <span className="mono text-[17px] text-ink">PM Interview Prep</span>
          <nav className="hidden items-center gap-1 md:flex">
            <a href="#features" className="mono rounded-full px-4 py-2 text-[15px] text-mute transition-colors hover:text-ink">
              Features
            </a>
            <a href="#how" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#demo" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              Demo
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {isAuth ? null : (
              <>
                <Button variant="ghost" onClick={() => navigate('/login')}>
                  Log in
                </Button>
                <Button onClick={() => navigate('/signup')}>
                  Get started <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-20 md:pt-28">
          <div className="grid items-center gap-12 md:grid-cols-[1.1fr_1fr]">
            <div className="space-y-6">
              <span className="mono inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[14px] text-mute">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Built on the actual PM loop
              </span>
              <h1 className="display text-[44px] leading-[1.05] md:text-[64px]">
                Practise the interview you will actually get.
              </h1>
              <p className="max-w-[700px] text-[20px] leading-relaxed text-mute">
                A structured product management interview with an interviewer that asks follow-ups, scores every
                answer against the rubric, and tells you what to change before the real one.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => navigate('/signup')}>
                  Start practising <ArrowRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate('/login')}>
                  I already have an account
                </Button>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                Runs on your own Cohere key. No subscription, no shared quota.
              </p>
            </div>
            <div id="demo">
              <DemoVideo />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-5">
            <Section
              title="What you get"
              description="Six things the app does, none of which are a chatbot pretending to be an interviewer."
              className="py-16"
            >
              <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((f) => (
                  <div key={f.title} className="space-y-3">
                    <f.icon className="h-5 w-5" aria-hidden="true" />
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="text-[16px] text-mute">{f.body}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl px-5">
          <Section title="How it works" description="Three steps, about two minutes of setup." className="py-16">
            <div className="grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.step} className="space-y-2 border-t pt-4">
                  <div className="font-mono text-xs text-muted-foreground">{s.step}</div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </Section>
        </section>

        {/* Stages */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-5">
            <Section
              title="Every round, on demand"
              description="Each stage has its own question bank and rubric, so a practice round is not a diluted full mock."
              className="py-16"
            >
              <div className="flex flex-wrap gap-2">
                {['Estimation', 'Product design', 'Case study', 'Strategy', 'Technical execution', 'Behavioural'].map(
                  (label) => (
                    <span key={label} className="mono inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[15px]">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {label}
                    </span>
                  )
                )}
              </div>
            </Section>
          </div>
        </section>

        {/* Close */}
        <section className="mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="display text-[34px] leading-tight">Your next interview is one practice round away.</h2>
          <p className="mx-auto mt-4 max-w-[620px] text-[18px] text-mute">
            Create an account, paste your resume, and run the round you are worst at.
          </p>
          <Button size="lg" className="mt-8" onClick={() => navigate('/signup')}>
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-xs text-muted-foreground">
          <span>PM Interview Prep</span>
          <span>Practice material only. Not affiliated with any employer.</span>
        </div>
      </footer>
    </div>
  );
}
