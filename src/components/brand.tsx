import { cx } from "./ui";

/** App icon: Chief's silver loop. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/avatars/loop-7.webp" alt="" aria-hidden width={size} height={size} style={{ width: size, height: size }} className={cx("shrink-0 select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.22)]", className)} />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("text-[1.0625rem] font-semibold tracking-[-0.02em]", className)}>Looper</span>;
}
