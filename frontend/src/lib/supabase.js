import { createClient } from '@supabase/supabase-js';

// Supabase owns authentication and the candidate's own records. The Node server
// next door owns the interview engine only, so this client is the single place
// that talks to Postgres.
//
// Both values come from the browser bundle, so they must be the anon key. The
// anon key is not a secret — row level security decides what it can reach.

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey && !/^your-/i.test(url));

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Every screen that needs the database has to handle "Supabase is not configured
// yet", because a fresh clone has no .env.local. One message beats a null
// dereference in six different components.
export const SUPABASE_MISSING_MESSAGE =
  'Supabase is not configured. Copy frontend/.env.example to frontend/.env.local, add your project URL and anon key, then restart the dev server.';

export function requireSupabase() {
  if (!supabase) throw new Error(SUPABASE_MISSING_MESSAGE);
  return supabase;
}
