// Shown while a page's data loads, so navigation is instant.
export default function Loading() {
  return (
    <div className="grid grid-cols-1 gap-5 pt-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="tile h-[420px] animate-pulse" />
      <div className="tile h-[560px] animate-pulse" />
    </div>
  );
}
