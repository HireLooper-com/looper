// Shown while a page's data loads, so navigation is instant.
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-4 py-8">
      <span className="h-8 w-56 animate-pulse rounded-full bg-ink/[0.06]" />
      <span className="h-4 w-80 animate-pulse rounded-full bg-ink/[0.04]" />
      <div className="tile mt-4 h-[320px] animate-pulse" />
    </div>
  );
}
