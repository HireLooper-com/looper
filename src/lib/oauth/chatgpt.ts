import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { emailAllowed, hostId, mutate, read, upsertUser } from "../db";

// Sign in with ChatGPT, plan-usage flavour for open-source / locally hosted apps.
// Protocol: https://developers.openai.com/siwc/token-sharing-open-source
const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
export const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const SHARING_SCOPE = "chatgpt.tokens.use.direct";
const DYNAMIC_CLIENT = "dynamic_agent_client";
const APP_NAME = "Chieflooper";
export const CALLBACK_PATH = "/auth/callback";
export const USAGE_URL = "https://chatgpt.com/settings/usage";

interface Pending {
  verifier: string;
  nonce: string;
  redirectUri: string;
  /** origin the user is browsing, e.g. http://localhost:3000 */
  origin: string;
  /** signed-in user connecting ChatGPT as a second subscription */
  linkUid?: string;
  /** the workspace that gets the connection (when linking from Settings) */
  linkWs?: string;
  clientId?: string;
  createdAt: number;
}

// Kept in server memory, not cookies: the callback lands on 127.0.0.1 while the user may browse localhost.
// After the callback, a one-time handoff code carries the session back to the user's origin.
const g = globalThis as {
  __chatgptPending?: Map<string, Pending>;
  __chatgptHandoff?: Map<string, { uid: string; at: number }>;
};
const pending = (g.__chatgptPending ??= new Map());
const handoffs = (g.__chatgptHandoff ??= new Map());

const b64url = (b: Buffer) => b.toString("base64url");

/**
 * Build the authorize URL. `clientId` is the user's issued registration when known (signed-in user,
 * or a returning browser); otherwise ChatGPT registers this app for them during sign-in.
 */
export async function startSignIn(opts: { port: string; origin: string; linkUid?: string; linkWs?: string; clientId?: string; loginHint?: string }) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const nonce = b64url(randomBytes(24));
  // Exactly 127.0.0.1 + /auth/callback; only the port may vary between sign-ins.
  const redirectUri = `http://127.0.0.1:${opts.port}${CALLBACK_PATH}`;

  for (const [k, v] of pending) if (Date.now() - v.createdAt > 15 * 60_000) pending.delete(k);
  pending.set(state, { verifier, nonce, redirectUri, origin: opts.origin, linkUid: opts.linkUid, linkWs: opts.linkWs, clientId: opts.clientId, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: opts.clientId ?? DYNAMIC_CLIENT,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    ext_agent_host_id: await hostId(),
  });
  if (!opts.clientId) params.set("agent_name_hint", APP_NAME);
  else if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTHORIZE_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
    redirect: "error",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error_description ?? data.error ?? `ChatGPT token request failed (${r.status})`);
    (err as Error & { code?: string }).code = data.error;
    throw err;
  }
  return data as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    earliest_refresh_at?: number;
    scope?: string;
  };
}

async function verifyIdToken(idToken: string, clientId: string, nonce?: string) {
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUER, audience: clientId, algorithms: ["RS256"] });
  if (nonce && payload.nonce !== nonce) throw new Error("ChatGPT sign-in failed: nonce mismatch");
  return { subject: String(payload.sub), email: typeof payload.email === "string" ? payload.email : undefined };
}

const toMs = (t?: number) => (t ? (t > 1e12 ? t : t * 1000) : undefined);

/** Handle GET /auth/callback. Returns where to send the browser next. */
export async function finishSignIn(url: URL): Promise<string> {
  const state = url.searchParams.get("state") ?? "";
  const p = pending.get(state);
  if (!p) throw new Error("This sign-in link expired. Start again.");
  pending.delete(state);
  const fail = (reason: string) => `${p.origin}${p.linkUid ? "/settings" : "/login"}?chatgpt=${reason}`;

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "declined" : "error");

  const returned = url.searchParams.get("client_id") ?? undefined;
  if (!p.clientId && (!returned || returned === DYNAMIC_CLIENT)) throw new Error("ChatGPT didn't finish registering this app. Try again.");
  if (p.clientId && returned && returned !== p.clientId) throw new Error("ChatGPT returned a different app registration.");
  const clientId = returned ?? p.clientId!;

  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    code: url.searchParams.get("code") ?? "",
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    resource: RESOURCE,
  });
  if (!tokens.id_token || !tokens.refresh_token) throw new Error("ChatGPT sign-in returned incomplete tokens.");
  const identity = await verifyIdToken(tokens.id_token, clientId, p.nonce);
  if (!p.linkUid && !emailAllowed(identity.email)) return fail("not-allowed");
  const scopes = (tokens.scope ?? url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);

  const user = await upsertUser({ provider: "openai", identity: `openai:${identity.subject}`, email: identity.email }, p.linkUid);
  await mutate(p.linkWs ?? user.id, (d) => {
    d.settings.chatgptClientId = clientId;
    d.settings.oauth.openai = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token!,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      earliestRefreshAt: toMs(tokens.earliest_refresh_at),
      scopes,
      ...identity,
    };
    d.settings.authMode.openai = "oauth";
    d.settings.provider = "openai";
  });

  const code = b64url(randomBytes(24));
  for (const [k, v] of handoffs) if (Date.now() - v.at > 2 * 60_000) handoffs.delete(k);
  handoffs.set(code, { uid: user.id, at: Date.now() });
  const sharing = scopes.includes(SHARING_SCOPE) ? "connected" : "no-sharing";
  return `${p.origin}/auth/finish?code=${code}&chatgpt=${sharing}${p.linkUid ? "&to=settings" : ""}`;
}

/** Redeem the one-time code from the callback; returns the user id to start a session for. */
export function redeemHandoff(code: string) {
  const h = handoffs.get(code);
  handoffs.delete(code);
  return h && Date.now() - h.at < 2 * 60_000 ? h.uid : null;
}

const RELOGIN = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

/** A valid access token. Refreshes under the workspace lock (refresh tokens rotate) when under a minute is left. */
export async function chatgptAccessToken(uid: string): Promise<string> {
  const db0 = await read(uid);
  const cred = db0.settings.oauth.openai;
  if (!cred) throw new Error("ChatGPT isn't connected. Use “Continue with ChatGPT”.");
  if (!cred.scopes.includes(SHARING_SCOPE)) throw new Error("ChatGPT plan sharing wasn't granted. Sign in again and allow plan usage.");
  const fresh = cred.expiresAt - Date.now() > 60_000;
  const tooEarly = cred.earliestRefreshAt && Date.now() < cred.earliestRefreshAt;
  if (fresh || (tooEarly && cred.expiresAt > Date.now())) return cred.accessToken;

  const clientId = db0.settings.chatgptClientId;
  if (!clientId) throw new Error("ChatGPT isn't connected. Sign in with ChatGPT again.");
  const outcome = await mutate(uid, async (db) => {
    const current = db.settings.oauth.openai;
    if (!current) return { error: "ChatGPT isn't connected. Use “Continue with ChatGPT”." };
    if (current.accessToken !== cred.accessToken) return { token: current.accessToken };
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", client_id: clientId, refresh_token: current.refreshToken, resource: RESOURCE });
      const identity = t.id_token ? await verifyIdToken(t.id_token, clientId) : undefined;
      if (identity && current.subject && identity.subject !== current.subject) return { error: "ChatGPT account changed during refresh." };
      db.settings.oauth.openai = {
        ...current,
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? current.refreshToken,
        expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
        earliestRefreshAt: toMs(t.earliest_refresh_at),
        scopes: t.scope ? t.scope.split(" ") : current.scopes,
      };
      return { token: t.access_token };
    } catch (e) {
      if (RELOGIN.has((e as { code?: string }).code ?? "")) {
        delete db.settings.oauth.openai;
        return { error: "Your ChatGPT session ended. Sign in with ChatGPT again." };
      }
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome.token;
}

export async function signOut(uid: string) {
  const db = await read(uid);
  const cred = db.settings.oauth.openai;
  const clientId = db.settings.chatgptClientId;
  if (cred && clientId) {
    await fetch(`${ISSUER}/api/accounts/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: cred.refreshToken, token_type_hint: "refresh_token", client_id: clientId }),
    }).catch(() => undefined);
  }
  // Keep the issued client id so the next sign-in reuses the registration.
  await mutate(uid, (d) => {
    delete d.settings.oauth.openai;
    d.settings.authMode.openai = "key";
  });
}

/** Models the user's plan can use. The response is { models: [{ slug, display_name, visibility }] }. */
export async function listChatGPTModels(uid: string) {
  const r = await fetch(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${await chatgptAccessToken(uid)}` } });
  if (!r.ok) throw new Error(`Couldn't list ChatGPT models (${r.status})`);
  const data = (await r.json()) as { models?: { slug: string; display_name?: string; visibility?: string }[] };
  return (data.models ?? []).filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, name: m.display_name ?? m.slug }));
}
