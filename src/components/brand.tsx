import { cx } from "./ui";

/** App icon: a loop on a blue-violet squircle. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx("app-icon inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#5e5ce6] via-[#0a84ff] to-[#30b0c7]", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" aria-hidden>
        <path d="M12 4.5a7.5 7.5 0 1 1-6.9 4.55" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M3.4 5.2 5.3 9.1l3.9-1.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.4" fill="#fff" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("text-[1.0625rem] font-semibold tracking-[-0.02em]", className)}>Chieflooper</span>;
}
