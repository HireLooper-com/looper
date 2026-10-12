// Self-hosted Looper has no billing, so onboarding never shows the Start Pro step.
export default function StartPro(_: { u: unknown; back?: string }) {
  return null;
}
