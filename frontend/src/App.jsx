import React from 'react';
import Shell from './components/Shell';
import { CANDIDATE_NAV } from './lib/nav';
import { matchPath, navigate, usePath } from './lib/route';
import { AuthProvider, useAuth } from './app/authContext';
import { PrepProvider, usePrep } from './app/prepContext';

import LandingPage from './views/LandingPage';
import AuthPage from './views/AuthPage';
import InterviewView from './views/InterviewView';

import OnboardingView from './app/OnboardingView';
import DashboardView from './app/DashboardView';
import PracticeSetupView from './app/PracticeSetupView';
import InterviewsView from './app/InterviewsView';
import InterviewDetailView from './app/InterviewDetailView';
import ProfileView from './app/ProfileView';

// Routing is split three ways on purpose:
//
//   public   /, /login, /signup        no session needed
//   gated    /app/*                    a session is required
//   bare     /app/practice/interview   a session is required and the app chrome
//                                       is suppressed, because an interview is a
//                                       full page, not a tab

function useSearch() {
  const path = usePath();
  const query = path.split('?')[1] || '';
  return new URLSearchParams(query);
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-24">
      <p className="kicker">Error 404</p>
      <h1 className="display mt-3 text-[34px] leading-[1.08]">Page not found</h1>
      <p className="mt-4 text-[15px] text-mute">That address does not match anything in the app.</p>
      <button
        className="mt-8 h-11 rounded-full bg-ink px-7 font-mono text-[11px] font-medium uppercase tracking-[0.13em] text-paper transition-opacity hover:opacity-80"
        onClick={() => navigate('/app')}
      >
        Go to the dashboard
      </button>
    </div>
  );
}

function InterviewRoute() {
  const { preset, consumePreset, setPreset } = usePrep();
  const search = useSearch();
  const sessionId = search.get('session');

  // A live round is linked from the dashboard and the history page as
  // /app/practice/interview?session=<id>. Folding that into the preset here
  // keeps the interview view reading from one place.
  React.useEffect(() => {
    if (!sessionId) return;
    // Guarded on the id itself: spreading `preset` back into it would build a
    // new object every run and re-trigger this effect forever.
    if (preset && preset.sessionId === sessionId) return;
    setPreset({ ...(preset || {}), sessionId, autoStart: true });
  }, [sessionId, preset, setPreset]);

  return <InterviewView preset={preset} onPresetConsumed={consumePreset} />;
}

function AppRoutes() {
  const path = usePath();
  const { signedIn, loading, needsOnboarding } = useAuth();

  const isPublic = path === '/' || path === '/login' || path === '/signup';
  const isInterview = path === '/app/practice/interview';

  // A candidate who is already signed in has no use for the login form, and one
  // who lands on /app without a session should not see an empty dashboard.
  React.useEffect(() => {
    if (loading) return;
    if (isPublic && signedIn && path !== '/') {
      navigate('/app', { replace: true });
    }
    if (!isPublic && !signedIn) {
      navigate('/login', { replace: true });
    }
  }, [loading, signedIn, isPublic, path]);

  if (loading) {
    return <div className="min-h-screen bg-background" />;
  }

  if (path === '/login' || path === '/signup') return <AuthPage />;
  if (isPublic) return <LandingPage />;
  if (!signedIn) return <div className="min-h-screen bg-background" />;

  if (path === '/onboarding') return <OnboardingView />;

  // Everything under /app needs a profile before it is useful: the interviewer
  // is handed the resume and target role, so an account without them produces
  // generic questions.
  if (needsOnboarding && !isInterview) return <OnboardingView />;

  if (isInterview) return <InterviewRoute />;

  if (path === '/app/interviews') return <InterviewsView />;
  const detail = matchPath('/app/interviews/:id', path);
  if (detail) return <InterviewDetailView interviewId={detail.id} />;

  if (path === '/app/practice' || path === '/app/practice/setup') return <PracticeSetupView />;
  if (path === '/app/profile') return <ProfileView />;
  if (path === '/app' || path === '/app/') {
    return <DashboardView onStartPractice={() => navigate('/app/practice')} />;
  }

  return <NotFoundPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <PrepProvider>
        <AppShell />
      </PrepProvider>
    </AuthProvider>
  );
}

// The chrome is applied here rather than inside AppRoutes so that the redirect
// checks above run against a bare tree. One wrapper, one place that knows which
// pages are inside the app.
function AppShell() {
  const path = usePath();
  const inApp = path.startsWith('/app') && path !== '/app/practice/interview' && path !== '/onboarding';
  const body = <AppRoutes />;
  if (!inApp) return body;
  return (
    <Shell brand="PM Interview Prep" nav={CANDIDATE_NAV}>
      {body}
    </Shell>
  );
}
