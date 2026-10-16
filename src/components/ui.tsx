import { useId } from "react";
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

// Two-tone glossy loops (pastel pairs); Chief is graphite.
const LOOPS: [string, string][] = [
  ["#f7a8c8", "#f4b88a"], // pink → peach
  ["#8fe0e8", "#4f8ff0"], // aqua → blue
  ["#f8d66a", "#f0803a"], // yellow → orange
  ["#a99cf2", "#7fc6ee"], // lavender → sky
  ["#c9ec8f", "#ece27c"], // lime → butter
  ["#f06aa0", "#8b4fe6"], // pink → violet
  ["#93ecc0", "#3fcfb0"], // mint → teal
];
const CHIEF_LOOP: [string, string] = ["#6b6b70", "#1d1d1f"];
// Loopers get their accent in turn when hired, so mapping accent → palette keeps neighbours distinct.
const ACCENT_LOOP: Record<Accent, number> = { green: 6, orange: 2, lavender: 5, blue: 1, ink: 0 };

// A Bernoulli lemniscate (figure eight), tilted like a resting loop, as an SVG path in a 100×100 box.
const LOOP_PATH = (() => {
  const pts: string[] = [];
  const a = 36;
  const tilt = (-38 * Math.PI) / 180;
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * 2 * Math.PI;
    const d = 1 + Math.sin(t) ** 2;
    const x = (a * Math.cos(t)) / d;
    const y = (a * Math.sin(t) * Math.cos(t)) / d;
    pts.push(`${(50 + x * Math.cos(tilt) - y * Math.sin(tilt)).toFixed(2)},${(50 + x * Math.sin(tilt) + y * Math.cos(tilt)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
})();

/** A looper's avatar: a glossy figure-eight tube in its own two-tone colour (Chief is graphite).
 * The palette follows the looper's accent (or `seed` when there is none). */
export function Bot({ color, size = 40, seed = "", dark = false, className }: { color?: Accent; size?: number; seed?: string; dark?: boolean; className?: string }) {
  const h = [...seed].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const [c1, c2] = dark ? CHIEF_LOOP : LOOPS[color ? ACCENT_LOOP[color] : h % LOOPS.length];
  // Unique per instance: a gradient defined inside a hidden element (e.g. the phone strip) can't be referenced.
  const id = `loop${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={cx("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
        <filter id={`${id}-s`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.6" floodColor={c2} floodOpacity="0.35" />
        </filter>
        <filter id={`${id}-b`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      <g filter={`url(#${id}-s)`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* body */}
        <path d={LOOP_PATH} stroke={`url(#${id}-g)`} strokeWidth="15" />
        {/* lower shade for depth */}
        <path d={LOOP_PATH} stroke="#000" strokeOpacity="0.12" strokeWidth="6" transform="translate(1.4 2.4)" />
        <path d={LOOP_PATH} stroke={`url(#${id}-g)`} strokeWidth="10" />
        {/* shine along the top of the tube */}
        <path d={LOOP_PATH} stroke="#fff" strokeOpacity={dark ? 0.3 : 0.55} strokeWidth="3.6" transform="translate(-1.4 -2.4)" filter={`url(#${id}-b)`} />
      </g>
    </svg>
  );
}

/** Looper avatar. The emoji is kept in data but loopers now show as bots. */
export function Avatar({ color, size = 40, seed }: { emoji?: string; color: Accent; size?: number; seed?: string }) {
  return <Bot color={color} size={size} seed={seed} />;
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
