// Local scheduler: checks for due skills every minute while the server is up.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.GROKLOOPER_TICKER === "off") return;
  const { tick } = await import("./lib/agent");
  const g = globalThis as { __grokTicker?: NodeJS.Timeout };
  if (g.__grokTicker) return;
  g.__grokTicker = setInterval(() => {
    tick().catch((e) => console.error("[ticker]", e));
  }, 60_000);
}
