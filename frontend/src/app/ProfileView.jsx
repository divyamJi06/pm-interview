import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, LogOut, Trash2 } from 'lucide-react';
import { Button, Input, Label, Textarea, Badge } from '../components/ui';
import { PageHeader, Section, KeyValue, Divider } from '../components/primitives';
import { useAuth } from './authContext';
import { maskKey, looksLikeCohereKey } from '../lib/apiKeys';
import { navigate } from '../lib/route';

// Profile and settings in one page. The API keys live here rather than in the
// interview setup wizard because a key is a setting, not part of configuring one
// round — the wizard only checks that a key exists.

const MAX_RESUME_CHARS = 8000;

function KeyField({ purpose, label, hint, value, onSave, onForget }) {
  const [draft, setDraft] = useState(value || '');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const dirty = draft.trim() !== (value || '').trim();

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onSave(purpose, draft);
      setMessage('Saved.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Input
            type={reveal ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={value ? maskKey(value) : 'Paste your key'}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {value ? (
          <Button variant="ghost" size="icon" aria-label="Forget this key" onClick={() => onForget(purpose)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {draft && !looksLikeCohereKey(draft) ? (
        <p className="text-xs text-developing">
          That does not look like a Cohere key. Save it anyway if you are sure — we only find out when we call Cohere.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Stored in this browser only, in localStorage. It is never written to our
        database, never synced, and never sent anywhere except this app&rsquo;s own
        interview server, which holds it in memory for the length of one round.
        Practising on another device means pasting the key again.
      </p>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function ProfileView() {
  const { profile, user, saveProfile, signOut, keys, saveKey, forgetKey } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState(() => ({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    email: profile?.email || user?.email || '',
    target_role: profile?.target_role || '',
    years_experience: profile?.years_experience ?? '',
    resume_text: profile?.resume_text || '',
    resume_file_name: profile?.resume_file_name || '',
  }));

  useEffect(() => {
    setDraft({
      full_name: profile?.full_name || '',
      phone: profile?.phone || '',
      email: profile?.email || user?.email || '',
      target_role: profile?.target_role || '',
      years_experience: profile?.years_experience ?? '',
      resume_text: profile?.resume_text || '',
      resume_file_name: profile?.resume_file_name || '',
    });
  }, [profile, user]);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await saveProfile({ ...draft, resume_text: draft.resume_text.slice(0, MAX_RESUME_CHARS) });
      setMessage('Profile saved. New interviews will use it.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full">
      <PageHeader title="Profile" description="What the interviewer knows about you, and the keys it runs on." />

      <form onSubmit={submit} className="space-y-8">
        <Section title="Details" className="pt-0">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={draft.full_name} onChange={set('full_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={draft.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={draft.email} onChange={set('email')} />
            </div>
            <div className="space-y-1.5">
              <Label>Years of experience</Label>
              <Input type="number" min="0" step="0.5" value={draft.years_experience} onChange={set('years_experience')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Target role</Label>
              <Input value={draft.target_role} onChange={set('target_role')} placeholder="Senior PM, B2B SaaS" />
            </div>
          </div>
        </Section>

        <Section title="Resume" description="Sent to the interviewer as context. First 8,000 characters only.">
          <Textarea value={draft.resume_text} onChange={set('resume_text')} rows={10} />
          <p className="mono mt-2 text-[15px] text-mute">
            {draft.resume_text.length.toLocaleString()} / {MAX_RESUME_CHARS.toLocaleString()} characters.
          </p>
        </Section>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </Button>
          {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
        </div>
      </form>

      <Divider className="my-12" />

      <Section
        title="API keys"
        description="The interview runs on your own Cohere key. Nothing is sent anywhere else, and your usage is billed to you."
      >
        <div className="space-y-8">
          <KeyField
            purpose="llm"
            label="Cohere key — runs the interviewer"
            hint="Required. Without it an interview cannot start."
            value={keys.llm}
            onSave={saveKey}
            onForget={async (p) => {
              await forgetKey(p);
              setMessage('Key removed.');
            }}
          />
          <KeyField
            purpose="stt"
            label="Cohere key — transcribes your voice answers"
            hint="Only needed if you answer out loud. Same key works if you want to keep it simple."
            value={keys.stt}
            onSave={saveKey}
            onForget={async (p) => {
              await forgetKey(p);
              setMessage('Key removed.');
            }}
          />
          <p className="flex items-start gap-2 text-[15px] text-mute">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Keys stay in this browser. We keep no copy: nothing here is written to the database. They are sent to the
            interview server only for the round that needs them, and never written to disk.
          </p>
        </div>
      </Section>

      <Divider className="my-12" />

      <Section title="Account">
        <div className="grid gap-6 sm:grid-cols-2">
          <KeyValue label="Signed in as">{user?.email || '—'}</KeyValue>
          <KeyValue label="Member since">
            {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
          </KeyValue>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate('/app')}>
            Back to dashboard
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
          {profile?.onboarding_complete ? <Badge variant="good">Profile complete</Badge> : null}
        </div>
      </Section>
    </div>
  );
}
