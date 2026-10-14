import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { Accent } from "@/lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// App-icon style gradients, like iCloud's tiles.
export const accentBg: Record<Accent, string> = {
  green: "bg-gradient-to-b from-[#5fd77a] to-[#28b44b]",
  orange: "bg-gradient-to-b from-[#ffb340] to-[#ff8a00]",
  lavender: "bg-gradient-to-b from-[#c77dff] to-[#9b4ddb]",
  blue: "bg-gradient-to-b from-[#4fa8ff] to-[#0a7cff]",
  ink: "bg-gradient-to-b from-[#5ac8e0] to-[#1e9cb8]",
};
export const accentHex: Record<Accent, string> = {
  green: "#34c759",
  orange: "#ff9500",
  lavender: "#af52de",
  blue: "#0071e3",
  ink: "#30b0c7",
};

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "soft" | "danger" | "light"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-8 px-3.5 text-[0.8125rem]" : "h-10 px-5 text-[0.9375rem]",
        variant === "primary" && "bg-blue text-white hover:bg-blue-hover",
        variant === "light" && "bg-white text-ink hover:bg-well",
        variant === "soft" && "bg-[#e8e8ed] text-ink hover:bg-[#dcdce1]",
        variant === "ghost" && "text-blue hover:bg-blue/8",
        variant === "danger" && "text-red hover:bg-red/8",
        className,
      )}
    />
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("tile", className)}>{children}</section>;
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

const inputCls = "w-full rounded-[10px] border border-[#d2d2d7] bg-white px-3 text-[0.9375rem] text-ink outline-none placeholder:text-faint focus:border-blue focus:ring-4 focus:ring-blue/15";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, "h-10", props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "py-2.5 leading-relaxed", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "h-10 appearance-none pr-8", props.className)} />;
}

export function Pill({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "green" | "orange" | "lavender" | "dark" | "blue" }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.75rem] font-medium",
        tone === "grey" && "bg-[#f0f0f3] text-ink-2",
        tone === "green" && "bg-green/15 text-green-deep",
        tone === "orange" && "bg-orange/12 text-orange",
        tone === "lavender" && "bg-lavender/15 text-[#8e3fbf]",
        tone === "dark" && "bg-ink text-white",
        tone === "blue" && "bg-blue/10 text-blue",
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ emoji, color, size = 40 }: { emoji: string; color: Accent; size?: number }) {
  return (
    <span
      className={cx("app-icon inline-flex shrink-0 items-center justify-center text-white", accentBg[color])}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {emoji}
    </span>
  );
}

export function Sparkline({ values, color = "#0071e3", width = 120, height = 36 }: { values: number[]; color?: string; width?: number; height?: number }) {
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
