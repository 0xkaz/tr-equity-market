// GENERATED from 0xkaz/equity-hub core/auth.ts (core 2026.10.06). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
// Google OAuth 2.0 (authorization code flow) + cookie sessions stored in D1.
// Shared by every sister site. Site-specific values (cookie prefix) come from src/site.ts.
//
// Two login modes:
//  - direct: the site talks to Google itself (redirect URI <site>/auth/google/callback must be registered in
//    the Google OAuth client). The client secret is the GOOGLE_CLIENT_SECRET secret, or the account-level
//    Secrets Store secret bound as GOOGLE_SECRET_STORE.
//  - hub (SSO): when SSO_HUB and SSO_KEY are set, /auth/google/login redirects to the hub
//    (equity.0xkaz.com/auth/login), which signs the user in with Google once for all sites and comes back
//    to <site>/auth/google/callback?sso=<token>&state=<state>. The token is HMAC-SHA256 signed with the
//    shared Secrets Store key SSO_SIGNING_KEY, bound to this site's origin and state, and valid for 2 minutes.
//    Only the hub's redirect URI has to be registered with Google.
import { SITE, type UserFields } from "../site";

// Minimal environment the auth module needs; each site's Env is a superset of this.
// A Secrets Store binding (account-level secret shared by several Workers)
export interface SecretRef { get(): Promise<string> }

export interface AuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_SECRET_STORE?: SecretRef;  // Secrets Store "GOOGLE_CLIENT_SECRET", used when the plain secret is not set
  SSO_HUB?: string;                 // e.g. https://equity.0xkaz.com — log in through the hub
  SSO_KEY?: SecretRef | string;     // Secrets Store "SSO_SIGNING_KEY" (a plain string is accepted for local dev)
  ALLOWED_EMAILS?: string;
  ADMIN_EMAILS?: string;
}
type Env = AuthEnv;

async function readSecret(v: SecretRef | string | undefined): Promise<string | undefined> {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  try { return await v.get(); } catch { return undefined; }
}
const googleSecret = (env: Env) => (env.GOOGLE_CLIENT_SECRET ? Promise.resolve(env.GOOGLE_CLIENT_SECRET) : readSecret(env.GOOGLE_SECRET_STORE));
const ssoEnabled = (env: Env) => Boolean(env.SSO_HUB && env.SSO_KEY);

// ---- SSO token (same format as equity-hub src/sso.js): base64url(JSON payload) "." base64url(HMAC-SHA256) ----
function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export interface SsoClaims { v: number; kind: string; sub: string; email: string; name?: string | null; picture?: string | null; aud: string; state: string; exp: number }
export async function verifySsoToken(secret: string, token: string): Promise<SsoClaims | null> {
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), new TextEncoder().encode(p)))) return null;
    return JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch { return null; }
}

// Columns common to every site's users table; per-site notification columns come from src/site.ts.
export interface BaseUser {
  id: string; email: string; name: string | null; picture: string | null;
  created_at: string; last_login_at: string;
}
export type User = BaseUser & UserFields;

const SESSION_COOKIE = `${SITE.cookiePrefix}_session`;
const STATE_COOKIE = `${SITE.cookiePrefix}_oauth_state`;
const SESSION_DAYS = 30;

function randomId(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, maxAgeSec: number, extra = ""): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}${extra}`;
}

export function allowedEmails(env: Env): string[] | null {
  const raw = (env.ALLOWED_EMAILS ?? "").trim();
  if (!raw) return null;
  return raw.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = (env.ADMIN_EMAILS ?? env.ALLOWED_EMAILS ?? "").trim();
  if (!raw) return false;
  return raw.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).includes(email.toLowerCase());
}

export function oauthConfigured(env: Env): boolean {
  return ssoEnabled(env) || Boolean(env.GOOGLE_CLIENT_ID && (env.GOOGLE_CLIENT_SECRET || env.GOOGLE_SECRET_STORE));
}

export function loginRedirect(env: Env, requestUrl: string, next: string): Response {
  const state = randomId(16);
  const origin = new URL(requestUrl).origin;
  if (ssoEnabled(env)) {
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    const q = new URLSearchParams({ return_to: `${origin}/auth/google/callback`, state });
    const h = new Headers({ Location: `${env.SSO_HUB!.replace(/\/+$/, "")}/auth/login?${q}` });
    h.append("Set-Cookie", cookie(STATE_COOKIE, `${state}|${safe}`, 600));
    return new Response(null, { status: 302, headers: h });
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const headers = new Headers({ Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  headers.append("Set-Cookie", cookie(STATE_COOKIE, `${state}|${safeNext}`, 600));
  return new Response(null, { status: 302, headers });
}

export async function handleCallback(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request.headers.get("cookie") ?? undefined);
  const [savedState, next = "/"] = (cookies[STATE_COOKIE] ?? "").split("|");
  const fail = (msg: string, status = 400) => new Response(`Login failed: ${msg}`, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);
  if (!state || !savedState || state !== savedState) return fail("invalid state");

  // Hub (SSO) login: verify the signed token instead of talking to Google
  const sso = url.searchParams.get("sso");
  if (sso) {
    const key = await readSecret(env.SSO_KEY);
    if (!key) return fail("SSO is not configured on this site", 503);
    const c = await verifySsoToken(key, sso);
    if (!c || c.v !== 1 || c.kind !== "site") return fail("invalid SSO token");
    if (c.aud !== url.origin) return fail("SSO token is for another site");
    if (c.state !== state) return fail("SSO state mismatch");
    if (!c.exp || c.exp * 1000 < Date.now()) return fail("SSO token expired");
    return finishLogin(env, { sub: c.sub, email: c.email, name: c.name ?? null, picture: c.picture ?? null }, next, fail);
  }

  if (!code) return fail("missing code");
  const secret = await googleSecret(env);
  if (!env.GOOGLE_CLIENT_ID || !secret) return fail("Google OAuth is not configured", 503);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: secret,
      redirect_uri: `${url.origin}/auth/google/callback`, grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail(`token exchange HTTP ${tokenRes.status}`, 502);
  const tok: any = await tokenRes.json();
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!infoRes.ok) return fail(`userinfo HTTP ${infoRes.status}`, 502);
  const info: any = await infoRes.json();
  const email = String(info.email ?? "").toLowerCase();
  if (!info.sub || !email) return fail("no email in Google profile");
  if (info.email_verified === false) return fail("email not verified");
  return finishLogin(env, { sub: info.sub, email, name: info.name ?? null, picture: info.picture ?? null }, next, fail);
}

// Create / update the user and start a session (shared by the direct and the hub login)
async function finishLogin(env: Env, info: { sub: string; email: string; name: string | null; picture: string | null }, next: string, fail: (msg: string, status?: number) => Response): Promise<Response> {
  const email = String(info.email ?? "").toLowerCase();
  if (!info.sub || !email) return fail("no email in profile");
  const allow = allowedEmails(env);
  if (allow && !allow.includes(email)) return fail(`${email} is not allowed to sign in`, 403);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, last_login_at = excluded.last_login_at`,
  ).bind(info.sub, email, info.name ?? null, info.picture ?? null, now).run();

  const sid = randomId(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)").bind(sid, info.sub, now, expires).run();

  const headers = new Headers({ Location: next.startsWith("/") && !next.startsWith("//") ? next : "/" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, sid, SESSION_DAYS * 86400));
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

export async function getUser(env: Env, request: Request): Promise<User | null> {
  const sid = parseCookies(request.headers.get("cookie") ?? undefined)[SESSION_COOKIE];
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1 AND s.expires_at > ?2`,
  ).bind(sid, new Date().toISOString()).first<User>();
  return row ?? null;
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const sid = parseCookies(request.headers.get("cookie") ?? undefined)[SESSION_COOKIE];
  if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(sid).run();
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}
