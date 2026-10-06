import React, { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

// The one mark Google allows providers to draw: the four-colour G on white.
function GoogleMark({ className }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
import { Button, Input, Label } from '../components/ui';
import { ThemeToggle } from '../components/Shell';
import { useAuth } from '../app/authContext';
import { navigate, usePath } from '../lib/route';
import { cn } from '../lib/utils';

// One component for /login and /signup. The two forms share a layout, an error
// slot and the "no Supabase configured" state, and only differ in which fields
// they show and which call they make.

function Field({ label, hint, error, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-[15px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export default function AuthPage() {
  const path = usePath();
  const mode = path === '/signup' ? 'signup' : 'login';
  const { signIn, signUp, signInWithGoogle, configError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // A candidate who is already signed in is redirected away by the router, so
  // this page never has to navigate during its own render.

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!email.trim()) return setError('Enter your email address.');
    if (password.length < 6) return setError('Passwords are at least 6 characters.');
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn({ email, password });
        navigate('/app');
      } else {
        const res = await signUp({ email, password });
        if (res.needsConfirmation) {
          setNotice(`Check ${res.email} for a confirmation link, then log in.`);
          setBusy(false);
          return;
        }
        // The profile details are collected on the next screen so a half-filled
        // signup form never leaves a profile row stranded.
        navigate('/onboarding');
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Google leaves the page, so there is nothing to await beyond the redirect
  // being accepted; the busy state only has to stop a double click.
  const google = async () => {
    setError('');
    setNotice('');
    setOauthBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message);
      setOauthBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <button onClick={() => navigate('/')} className="mono text-[17px] text-ink">
            PM Interview Prep
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
        <button
          onClick={() => navigate('/')}
          className="mono mb-8 inline-flex w-fit items-center gap-1.5 text-[15px] text-mute transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <h1 className="display text-[38px] leading-[1.1]">
          {mode === 'login' ? 'Log in' : 'Create your account'}
        </h1>
        <p className="mt-3 text-[18px] text-mute">
          {mode === 'login'
            ? 'Pick up your practice history where you left it.'
            : 'Next you will add your name, phone and resume so the interviewer knows who it is talking to.'}
        </p>

        {configError ? (
          <div className="inset mt-6 px-5 py-4 text-[16px] text-destructive">
            {configError}
          </div>
        ) : null}

        <div className="mt-8">
          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="w-full"
            onClick={google}
            disabled={oauthBusy || Boolean(configError)}
          >
            <GoogleMark className="h-[18px] w-[18px]" />
            {oauthBusy ? 'Opening Google…' : 'Continue with Google'}
          </Button>

          <div className="my-6 flex items-center gap-4">
            <span className="h-px flex-1 bg-line" />
            <span className="mono text-[11px] uppercase tracking-[0.13em] text-mute">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={busy}
            />
          </Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={busy}
            />
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-good">{notice}</p> : null}

          <Button type="submit" size="lg" className="w-full" disabled={busy || Boolean(configError)}>
            {busy ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}
            {busy ? null : <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          {mode === 'login' ? 'No account yet? ' : 'Already have an account? '}
          <button
            className={cn('font-medium text-foreground underline underline-offset-2')}
            onClick={() => {
              setError('');
              setNotice('');
              navigate(mode === 'login' ? '/signup' : '/login');
            }}
          >
            {mode === 'login' ? 'Create one' : 'Log in'}
          </button>
        </p>
      </main>
    </div>
  );
}
