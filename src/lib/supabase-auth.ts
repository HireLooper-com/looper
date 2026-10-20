import "server-only";

// Sign-in through Supabase Auth (Google, GitHub, 6-digit email codes). The browser talks to
// Supabase; we only verify the resulting access token here and then use our own session cookie.

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseAuth = () => !!(url() && anon());

export interface SupabaseIdentity {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  provider: "google" | "github" | "email";
}

/** Who this Supabase access token belongs to, checked with Supabase itself. */
export async function verifySupabaseToken(accessToken: string): Promise<SupabaseIdentity> {
  if (!hasSupabaseAuth()) throw new Error("Sign-in isn't configured on this server.");
  const r = await fetch(`${url()}/auth/v1/user`, { headers: { apikey: anon()!, authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!r.ok) throw new Error("Sign-in didn't complete. Try again.");
  const u = (await r.json()) as { id: string; email?: string; email_confirmed_at?: string; user_metadata?: Record<string, unknown>; app_metadata?: { provider?: string } };
  const meta = u.user_metadata ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const provider = u.app_metadata?.provider === "google" || u.app_metadata?.provider === "github" ? u.app_metadata.provider : "email";
  return {
    id: u.id,
    // Only a confirmed email may match an existing account.
    email: u.email_confirmed_at ? u.email : undefined,
    name: str(meta.full_name) ?? str(meta.name) ?? str(meta.user_name),
    avatar: str(meta.avatar_url) ?? str(meta.picture),
    provider,
  };
}
