import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { emailAllowed, mutate, read, upsertUser } from "../db";
import type { OAuthCredential } from "../types";

// Grok subscription sign-in (SuperGrok / X Premium) via device code.
// xAI has no public OAuth client for third-party apps; like OpenClaw, OpenCode and Hermes,
// this borrows the Grok CLI's public client. Unofficial — it can change or stop working.
const ISSUER = "https://auth.x.ai";
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_URL = `${ISSUER}/oauth2/device/code`;
const TOKEN_URL = `${ISSUER}/oauth2/token`;
const REVOKE_URL = `${ISSUER}/oauth2/revoke`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const GROK_USAGE_URL = "https://grok.com/?_s=usage";
export const API_BASE = "https://api.x.ai/v1";
export const CLI_PROXY_BASE = "https://cli-chat-proxy.grok.com/v1";

interface Device {
  deviceCode: string;
  interval: number;
  expiresAt: number;
  nextPollAt: number;
  /** signed-in user connecting Grok as a second subscription */
  linkUid?: string;
}

const g = globalThis as { __grokDevices?: Map<string, Device>; __grokRefresh?: Map<string, Promise<OAuthCredential>> };
const devices = (g.__grokDevices ??= new Map());
const refreshing = (g.__grokRefresh ??= new Map());

async function post(url: string, body: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/** Step 1: get a code the user confirms on x.ai. Returns a flow id the browser polls with. */
export async function startDevice(linkUid?: string) {
  const { ok, status, data } = await post(DEVICE_URL, { client_id: CLIENT_ID, scope: SCOPE });
  if (!ok) throw new Error(data.error_description ?? `xAI sign-in unavailable (${status})`);
  const interval = Number(data.interval ?? 5);
  const flowId = randomBytes(18).toString("base64url");
  for (const [k, v] of devices) if (Date.now() > v.expiresAt) devices.delete(k);
  const device: Device = {
    deviceCode: data.device_code,
    interval,
    expiresAt: Date.now() + Number(data.expires_in ?? 300) * 1000,
    nextPollAt: Date.now() + interval * 1000,
    linkUid,
  };
  devices.set(flowId, device);
  return {
    flowId,
    userCode: data.user_code as string,
    verificationUri: data.verification_uri as string,
    verificationUriComplete: (data.verification_uri_complete ?? data.verification_uri) as string,
    interval,
    expiresAt: device.expiresAt,
  };
}

async function identityOf(idToken?: string) {
  if (!idToken) return {};
  try {
    const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUER, audience: CLIENT_ID });
    return { subject: String(payload.sub), email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return {};
  }
}

function credentialFrom(data: Record<string, unknown>, prev?: OAuthCredential): Omit<OAuthCredential, "email" | "subject"> {
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token ?? prev?.refreshToken ?? ""),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    scopes: typeof data.scope === "string" ? data.scope.split(" ") : (prev?.scopes ?? SCOPE.split(" ")),
  };
}

type PollResult = { status: "pending" | "denied" | "expired" | "not-allowed" } | { status: "connected"; uid: string; linked: boolean };

/** Step 2: the browser calls this every `interval` seconds; one token request per call. */
export async function pollDevice(flowId: string): Promise<PollResult> {
  const d = devices.get(flowId);
  if (!d || Date.now() > d.expiresAt) return { status: "expired" };
  if (Date.now() < d.nextPollAt) return { status: "pending" };

  const { ok, data } = await post(TOKEN_URL, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: CLIENT_ID,
    device_code: d.deviceCode,
  });
  if (!ok) {
    switch (data.error) {
      case "authorization_pending":
        d.nextPollAt = Date.now() + d.interval * 1000;
        return { status: "pending" };
      case "slow_down":
        d.interval += 5;
        d.nextPollAt = Date.now() + d.interval * 1000;
        return { status: "pending" };
      case "access_denied":
      case "authorization_denied":
        devices.delete(flowId);
        return { status: "denied" };
      case "expired_token":
        devices.delete(flowId);
        return { status: "expired" };
      default:
        devices.delete(flowId);
        throw new Error(data.error_description ?? data.error ?? "xAI sign-in failed");
    }
  }
  devices.delete(flowId);
  if (!data.refresh_token) throw new Error("xAI didn't return a refresh token. Try signing in again.");
  const identity = await identityOf(data.id_token);
  if (!identity.subject) throw new Error("xAI didn't confirm who signed in. Try again.");
  if (!d.linkUid && !emailAllowed(identity.email)) return { status: "not-allowed" };

  const user = await upsertUser({ provider: "xai", subject: identity.subject, email: identity.email }, d.linkUid);
  await mutate(user.id, (db) => {
    db.settings.oauth.xai = { ...credentialFrom(data), ...identity };
    db.settings.authMode.xai = "oauth";
    db.settings.provider = "xai";
  });
  return { status: "connected", uid: user.id, linked: !!d.linkUid };
}

async function refresh(uid: string, cred: OAuthCredential): Promise<OAuthCredential> {
  // Refresh tokens rotate and may be single-use: never retry this request blindly.
  const { ok, status, data } = await post(TOKEN_URL, { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: cred.refreshToken });
  if (!ok) {
    if (status === 400 || status === 401 || data.error === "invalid_grant") {
      await mutate(uid, (db) => void delete db.settings.oauth.xai);
      throw new Error("Your Grok session ended. Sign in with Grok again.");
    }
    throw new Error(data.error_description ?? `Couldn't refresh the Grok session (${status})`);
  }
  const next: OAuthCredential = { ...cred, ...credentialFrom(data, cred) };
  await mutate(uid, (db) => void (db.settings.oauth.xai = next));
  return next;
}

export async function grokAccessToken(uid: string, force = false): Promise<string> {
  const cred = (await read(uid)).settings.oauth.xai;
  if (!cred) throw new Error("Grok isn't connected. Use “Continue with Grok”.");
  if (!force && cred.expiresAt - Date.now() > 5 * 60_000) return cred.accessToken;
  let p = refreshing.get(uid);
  if (!p) {
    p = refresh(uid, cred).finally(() => refreshing.delete(uid));
    refreshing.set(uid, p);
  }
  return (await p).accessToken;
}

export async function signOut(uid: string) {
  const cred = (await read(uid)).settings.oauth.xai;
  if (cred) await post(REVOKE_URL, { token: cred.refreshToken, token_type_hint: "refresh_token", client_id: CLIENT_ID }).catch(() => undefined);
  await mutate(uid, (db) => {
    delete db.settings.oauth.xai;
    db.settings.authMode.xai = "key";
  });
}

/** Headers the Grok CLI proxy expects (opt-in route; identifies as the Grok CLI). */
let cliVersion: { v: string; at: number } | undefined;
export async function cliProxyHeaders(): Promise<Record<string, string>> {
  if (!cliVersion || Date.now() - cliVersion.at > 6 * 3600_000) {
    const v = await fetch("https://x.ai/cli/stable", { signal: AbortSignal.timeout(4000) })
      .then((r) => r.text())
      .then((t) => t.trim())
      .catch(() => "");
    cliVersion = { v: /^\d+\.\d+\.\d+$/.test(v) ? v : "1.0.52", at: Date.now() };
  }
  return {
    "x-grok-client-identifier": "grok-shell",
    "x-grok-client-version": cliVersion.v,
    "x-grok-client-mode": "interactive",
    "X-XAI-Token-Auth": "xai-grok-cli",
  };
}

/** xAI answers 403 when the subscription tier or monthly quota doesn't cover this use. That's not an auth failure. */
export function isGrokEntitlementError(message: string) {
  return /run out of (available resources|credits)|need a Grok subscription|active Grok subscription|spending[- ]limit|personal-team-blocked|permission-denied/i.test(message);
}
