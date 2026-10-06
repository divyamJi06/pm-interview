import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabaseConfigured, requireSupabase, SUPABASE_MISSING_MESSAGE } from '../lib/supabase';
import { readLocalKey, writeLocalKey } from '../lib/apiKeys';
import { setAccessToken } from '../lib/utils';

// One provider for the signed-in candidate: the Supabase session, the profile
// row that onboarding fills in, and the bring-your-own-key material.
//
// It replaced a context that kept its own boolean in localStorage and called
// server endpoints for the profile. With Supabase the session is the source of
// truth, so a refresh or a second tab cannot disagree about who is signed in.

const AuthContext = createContext(null);

// Signup collects the whole profile in one form, so the insert is one round trip
// rather than a create followed by an update the candidate could navigate away
// from halfway through.
const EMPTY_PROFILE = {
  full_name: '',
  phone: '',
  email: '',
  target_role: '',
  years_experience: '',
  resume_text: '',
  resume_file_name: '',
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(supabaseConfigured ? '' : SUPABASE_MISSING_MESSAGE);
  const [keys, setKeys] = useState({ llm: '', stt: '' });

  // The server checks who is asking, so the current access token is published to
  // the API helper for as long as the session lives. Set during render rather
  // than in an effect: React runs child effects before parent effects, so an
  // effect here would publish the token only after the first fetch of every
  // screen had already gone out anonymous and been refused with a 401.
  // Sign-out clears it because the render below assigns null for a session with
  // no token, and a stale token would keep answering requests after the account
  // that owned it had gone.
  setAccessToken(session?.access_token || null);

  useEffect(() => () => setAccessToken(null), []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return undefined;
    }
    const sb = supabaseConfigured && requireSupabase();
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      setUser(data.session?.user || null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user || null);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!supabaseConfigured) return null;
    const sb = requireSupabase();
    const { data: auth } = await sb.auth.getUser();
    const current = auth && auth.user;
    if (!current) {
      setProfile(null);
      return null;
    }
    const { data, error } = await sb.from('profiles').select('*').eq('id', current.id).maybeSingle();
    if (error) {
      setConfigError(error.message);
      return null;
    }
    const row = data || { id: current.id, email: current.email || '', onboarding_complete: false, ...EMPTY_PROFILE };
    setProfile(row);
    return row;
  }, []);

  // Provider keys are read straight from localStorage and nowhere else. There is
  // no account copy to fall back to, so this is a synchronous read that never
  // waits on the network.
  const loadKeys = useCallback(async () => {
    const next = { llm: readLocalKey('llm'), stt: readLocalKey('stt') };
    setKeys(next);
    return next;
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setKeys({ llm: '', stt: '' });
      return;
    }
    loadProfile();
    loadKeys();
  }, [user, loadProfile, loadKeys]);

  const signUp = useCallback(async ({ email, password, fullName, phone, targetRole, resumeText, resumeFileName }) => {
    const sb = requireSupabase();
    const cleanEmail = String(email || '').trim();
    const { data, error } = await sb.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: String(fullName || '').trim() } },
    });
    if (error) throw new Error(error.message);
    const created = data && data.user;
    // With email confirmation on, Supabase returns a user but no session, and the
    // candidate has to click the link before anything else works.
    if (created && !data.session) {
      return { needsConfirmation: true, email: cleanEmail };
    }
    if (created) {
      const { error: profileError } = await sb
        .from('profiles')
        .upsert(
          {
            id: created.id,
            email: cleanEmail,
            full_name: String(fullName || '').trim(),
            phone: String(phone || '').trim(),
            target_role: String(targetRole || '').trim(),
            resume_text: String(resumeText || '').trim(),
            resume_file_name: String(resumeFileName || '').trim(),
            onboarding_complete: true,
          },
          { onConflict: 'id' }
        );
      if (profileError) throw new Error(profileError.message);
    }
    return { needsConfirmation: false, email: cleanEmail };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const sb = requireSupabase();
    const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password });
    if (error) throw new Error(error.message);
  }, []);

  // Google goes through the hosted consent screen, so this call leaves the page
  // and the session arrives on the way back through detectSessionInUrl. The
  // redirect target has to be a URL the Supabase dashboard also lists, or
  // Google refuses the request before it ever reaches us.
  const signInWithGoogle = useCallback(async () => {
    const sb = requireSupabase();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/app`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (supabaseConfigured) await requireSupabase().auth.signOut();
    setProfile(null);
    setKeys({ llm: '', stt: '' });
  }, []);

  const saveProfile = useCallback(async (draft) => {
    const sb = requireSupabase();
    const { data: auth } = await sb.auth.getUser();
    const current = auth && auth.user;
    if (!current) throw new Error('Not signed in.');
    const row = {
      id: current.id,
      full_name: String(draft.full_name || '').trim(),
      phone: String(draft.phone || '').trim(),
      email: String(draft.email || current.email || '').trim(),
      target_role: String(draft.target_role || '').trim(),
      years_experience:
        draft.years_experience === '' || draft.years_experience == null
          ? null
          : Number(draft.years_experience),
      resume_text: String(draft.resume_text || '').trim(),
      resume_file_name: String(draft.resume_file_name || '').trim(),
      onboarding_complete: true,
    };
    const { data, error } = await sb.from('profiles').upsert(row, { onConflict: 'id' }).select().single();
    if (error) throw new Error(error.message);
    setProfile(data);
    return data;
  }, []);

  const saveKey = useCallback(async (purpose, value) => {
    writeLocalKey(purpose, String(value || '').trim());
    setKeys((prev) => ({ ...prev, [purpose]: String(value || '').trim() }));
  }, []);

  const forgetKey = useCallback(async (purpose) => {
    writeLocalKey(purpose, '');
    setKeys((prev) => ({ ...prev, [purpose]: '' }));
  }, []);

  const needsOnboarding = Boolean(user && profile && !profile.onboarding_complete);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      configError,
      signedIn: Boolean(user),
      needsOnboarding,
      keys,
      reloadProfile: loadProfile,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      saveProfile,
      saveKey,
      forgetKey,
    }),
    [session, user, profile, loading, configError, needsOnboarding, keys, loadProfile, signUp, signIn, signInWithGoogle, signOut, saveProfile, saveKey, forgetKey]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
