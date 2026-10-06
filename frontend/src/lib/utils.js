import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtLat(ms) {
  if (ms == null || Number.isNaN(ms)) return '';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms';
}

export function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function fmtMoney(c) {
  if (c == null) return '—';
  // Salary bands are free text ("$190k - $215k + equity"), so only format
  // actual numbers and pass anything else through untouched.
  if (typeof c === 'string' && !/^\s*-?[\d.]+\s*$/.test(c)) return c.trim();
  const n = Number(c);
  if (!Number.isFinite(n)) return '—';
  return '$' + n.toFixed(4);
}

export function dateNice(ts) {
  return new Date(ts).toLocaleString();
}

export function relDate(ts) {
  return new Date(ts).toLocaleDateString();
}

export function readLocal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
}

// Supabase access token for the signed-in candidate, or null. Set once by the
// auth provider so that every call site is authenticated without each one having
// to thread the session through: a new call site that forgets the token fails
// loudly against the server instead of silently reading as anonymous.
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export async function json(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Application-scoped endpoints authenticate with the per-application access
  // token rather than the session cookie.
  const bearer = token || accessToken;
  if (bearer) headers.authorization = 'Bearer ' + bearer;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

export async function api(method, path, body, token) {
  const res = await json(method, path, body, token);
  if (!res.data || res.data.ok === false) {
    const err = new Error((res.data && res.data.error) || ('Request failed: ' + path + ' (' + res.status + ')'));
    // Carried so callers can tell "sign in" (401) from "no longer available".
    err.status = res.status;
    throw err;
  }
  return res.data;
}

export const VERDICT_CLASS = { strong: 'text-good', developing: 'text-developing', weak: 'text-weak' };
export const DECISION_CLASS = { follow_up: 'text-developing', next_question: 'text-primary', next_stage: 'text-primary', end_interview: 'text-good' };