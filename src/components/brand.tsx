import { cx } from "./ui";

/** App icon: the looper figure-eight on a blue gradient squircle (from hirelooper.com). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={cx("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="cl-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7A9BFF" />
          <stop offset=".5" stopColor="#3D6BFF" />
          <stop offset="1" stopColor="#1F38B8" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="url(#cl-logo)" />
      <path d="M50 50C58 34 82 34 82 50C82 66 58 66 50 50C42 34 18 34 18 50C18 66 42 66 50 50Z" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("text-[1.0625rem] font-semibold tracking-[-0.02em]", className)}>Looper</span>;
}
