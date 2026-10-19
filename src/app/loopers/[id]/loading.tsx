/** Looper skeleton: the header strip and a few chat-shaped blocks while the page loads. */
export default function LooperLoading() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-4 border-b border-ink/[0.05] px-6 py-3.5">
        {[44, 46, 72, 42, 48].map((w, i) => (
          <span key={i} className="h-4 animate-pulse rounded-full bg-ink/[0.06]" style={{ width: w }} />
        ))}
        <span className="ml-auto h-6 w-48 animate-pulse rounded-full bg-ink/[0.05]" />
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-4 py-6">
        {[70, 45, 80, 55].map((w, i) => (
          <span key={i} className={`h-16 animate-pulse rounded-[18px] bg-ink/[0.04] ${i % 2 ? "self-end" : ""}`} style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
