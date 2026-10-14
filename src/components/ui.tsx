import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { Accent } from "@/lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const accentBg: Record<Accent, string> = {
  green: "bg-green",
  orange: "bg-orange",
  lavender: "lavender-orb",
  blue: "bg-blue",
  ink: "bg-ink-2",
};
export const accentHex: Record<Accent, string> = {
  green: "#5dd674",
  orange: "#f8572c",
  lavender: "#9188ff",
  blue: "#7ab8ff",
  ink: "#242424",
};

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "soft" | "danger" | "light"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-8 px-3.5 text-[0.8125rem]" : "h-10 px-5 text-[0.875rem]",
        variant === "primary" && "bg-ink text-white hover:bg-ink-2",
        variant === "light" && "bg-white text-ink hover:bg-well",
        variant === "soft" && "bg-well text-ink hover:bg-line",
        variant === "ghost" && "text-mute hover:bg-well hover:text-ink",
        variant === "danger" && "text-orange hover:bg-orange/10",
        className,
      )}
    />
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-[8px] border border-line bg-panel", className)}>{children}</section>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[0.75rem] text-mute">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-[6px] border border-line bg-white px-3 text-[0.875rem] text-ink outline-none placeholder:text-faint focus:border-ink";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, "h-10", props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "py-2.5 leading-relaxed", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "h-10 appearance-none pr-8", props.className)} />;
}

export function Pill({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "green" | "orange" | "lavender" | "dark" }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] font-medium",
        tone === "grey" && "bg-well text-ink-2",
        tone === "green" && "bg-green/20 text-green-deep",
        tone === "orange" && "bg-orange/12 text-orange",
        tone === "lavender" && "bg-lavender/25 text-[#4b41c9]",
        tone === "dark" && "bg-ink text-white",
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ emoji, color, size = 40 }: { emoji: string; color: Accent; size?: number }) {
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full", accentBg[color], color === "ink" && "text-white")}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {emoji}
    </span>
  );
}

export function Sparkline({ values, color = "#0a0a0a", width = 120, height = 36 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <div style={{ width, height }} className="flex items-center text-[0.6875rem] text-faint">no trend yet</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 3 - ((v - min) / span) * (height - 6)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)!.split(",")[0]} cy={pts.at(-1)!.split(",")[1]} r={2.5} fill={color} />
    </svg>
  );
}

export function fmt(n: number | undefined) {
  if (n === undefined) return "—";
  return Intl.NumberFormat("en", { maximumFractionDigits: 2, notation: Math.abs(n) >= 100_000 ? "compact" : "standard" }).format(n);
}

export function timeAgo(iso?: string) {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
