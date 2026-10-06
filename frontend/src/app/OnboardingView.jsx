import React, { useMemo, useState } from 'react';
import { ArrowRight, FileText, Upload, X } from 'lucide-react';
import { Button, Input, Label, Select, Textarea } from '../components/ui';
import { PageHeader, Section, Stepper } from '../components/primitives';
import { ThemeToggle } from '../components/Shell';
import { useAuth } from './authContext';
import { navigate } from '../lib/route';

// Profile capture. Reached two ways: straight after signup, and by any
// signed-in candidate whose profile is still incomplete. Both land on the same
// form, so the fields and the rules about them exist once.
//
// Resume is read in the browser and stored as text, not uploaded to a bucket.
// The engine only ever needs the first 8000 characters as prompt context, and a
// public bucket for someone's resume is a liability with no upside.

const STEPS = ['Your details', 'Target role', 'Resume', 'Review'];

const ROLES = [
  'Associate PM',
  'PM',
  'Senior PM',
  'Staff PM',
  'Group PM',
  'Product Lead',
  'Head of Product',
];

const MAX_RESUME_CHARS = 8000;

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

export default function OnboardingView() {
  const { user, profile, saveProfile, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(() => ({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    email: profile?.email || user?.email || '',
    target_role: profile?.target_role || '',
    years_experience: profile?.years_experience ?? '',
    resume_text: profile?.resume_text || '',
    resume_file_name: profile?.resume_file_name || '',
  }));

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const problems = useMemo(() => {
    const out = {};
    if (!draft.full_name.trim()) out.full_name = 'The interviewer needs a name to call you.';
    if (draft.phone && !/^[\d\s+()-]{6,20}$/.test(draft.phone.trim())) out.phone = 'That does not look like a phone number.';
    if (!draft.target_role.trim()) out.target_role = 'Pick the role you are interviewing for.';
    if (!draft.resume_text.trim()) out.resume_text = 'Paste your resume so the questions fit your experience.';
    if (draft.years_experience !== '' && !Number.isFinite(Number(draft.years_experience))) {
      out.years_experience = 'Use a number, or leave it blank.';
    }
    return out;
  }, [draft]);

  const canAdvance = step === 0 ? !problems.full_name && !problems.phone : step === 1 ? !problems.target_role : step === 2 ? !problems.resume_text : true;

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await saveProfile({
        ...draft,
        resume_text: draft.resume_text.slice(0, MAX_RESUME_CHARS),
      });
      navigate('/app');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <span className="mono text-[17px] text-ink">PM Interview Prep</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-10 py-14">
        <PageHeader
          title="Set up your profile"
          description="This is the context the interviewer works from. It takes about two minutes."
        />
        <Stepper steps={STEPS} current={step} className="mb-10" />

        {error ? <p className="mb-6 text-[17px] text-destructive">{error}</p> : null}

        {step === 0 ? (
          <Section title="Your details">
            <div className="max-w-md space-y-5">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input value={draft.full_name} onChange={set('full_name')} placeholder="Divyam Gupta" />
                {problems.full_name ? <p className="text-[15px] text-destructive">{problems.full_name}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label>Phone number</Label>
                <Input value={draft.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
                {problems.phone ? <p className="text-xs text-destructive">{problems.phone}</p> : null}
                <p className="text-xs text-muted-foreground">Optional. Only used if you want a reminder before a round.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={draft.email} onChange={set('email')} />
                <p className="text-xs text-muted-foreground">This is the address you signed up with.</p>
              </div>
            </div>
          </Section>
        ) : null}

        {step === 1 ? (
          <Section title="What are you interviewing for?">
            <div className="max-w-md space-y-5">
              <div className="space-y-1.5">
                <Label>Target role</Label>
                <Input
                  value={draft.target_role}
                  onChange={set('target_role')}
                  placeholder="Senior PM, B2B SaaS"
                  list="role-options"
                />
                <datalist id="role-options">
                  {ROLES.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
                {problems.target_role ? <p className="text-xs text-destructive">{problems.target_role}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label>Years of experience</Label>
                <Input
                  type="number"
                  min="0"
                  max="40"
                  step="0.5"
                  value={draft.years_experience}
                  onChange={set('years_experience')}
                  placeholder="4"
                />
                {problems.years_experience ? (
                  <p className="text-xs text-destructive">{problems.years_experience}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Optional. Sets the seniority the interviewer assumes.</p>
                )}
              </div>
            </div>
          </Section>
        ) : null}

        {step === 2 ? (
          <Section
            title="Your resume"
            description="Paste the text, or upload a .txt / .md file. Questions get sharper when the interviewer knows your actual work."
          >
            <div className="w-full max-w-[860px] space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <label className="mono inline-flex h-[46px] cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-5 text-[16px] text-mute transition-colors hover:border-ink hover:text-ink">
                  <Upload className="h-4 w-4" /> Upload a file
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files && e.target.files[0];
                      if (!file) return;
                      try {
                        const text = await readFileAsText(file);
                        setDraft((d) => ({
                          ...d,
                          resume_text: text.slice(0, MAX_RESUME_CHARS),
                          resume_file_name: file.name,
                        }));
                        setError('');
                      } catch (err) {
                        setError(err.message);
                      }
                    }}
                  />
                </label>
                {draft.resume_file_name ? (
                  <span className="mono inline-flex items-center gap-2 text-[14px] text-mute">
                    <FileText className="h-3.5 w-3.5" /> {draft.resume_file_name}
                    <button
                      type="button"
                      aria-label="Remove uploaded file"
                      onClick={() => setDraft((d) => ({ ...d, resume_text: '', resume_file_name: '' }))}
                      className="hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : null}
              </div>
              <Textarea
                value={draft.resume_text}
                onChange={set('resume_text')}
                rows={12}
                placeholder="Paste your resume here…"
              />
              {problems.resume_text ? (
                <p className="text-xs text-destructive">{problems.resume_text}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {draft.resume_text.length.toLocaleString()} / {MAX_RESUME_CHARS.toLocaleString()} characters.
                </p>
              )}
            </div>
          </Section>
        ) : null}

        {step === 3 ? (
          <Section title="Ready to go">
            <dl className="max-w-md space-y-3 text-sm">
              {[
                ['Name', draft.full_name],
                ['Phone', draft.phone || '—'],
                ['Email', draft.email],
                ['Target role', draft.target_role],
                ['Experience', draft.years_experience === '' ? '—' : `${draft.years_experience} years`],
                ['Resume', draft.resume_file_name || `${draft.resume_text.length.toLocaleString()} characters pasted`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-6 border-b border-line pb-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-md text-sm text-muted-foreground">
              You can change any of this later from your profile page.
            </p>
          </Section>
        ) : null}

        <div className="mt-10 flex items-center justify-between gap-3">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="lg" disabled={busy} onClick={finish}>
              {busy ? 'Saving…' : 'Finish and open my dashboard'} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
