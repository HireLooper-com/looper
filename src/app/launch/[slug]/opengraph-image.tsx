import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { fmt } from "@/components/ui";
import { getLaunch, launchDayLabel } from "@/lib/launch";

export const alt = "Live Product Hunt launch scoreboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Same font and logo as the invite preview.
const OG = path.join(process.cwd(), "src/app/invite/[token]/og");
const asset = (file: string) => readFile(path.join(OG, file));

/** Link preview for a launch scoreboard: rank, upvotes and comments, in the hirelooper.com hero style. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [l, font, logo] = await Promise.all([getLaunch(slug), asset("Geist-SemiBold.ttf"), asset("logo.png")]);
  const p = l?.points.at(-1);
  const full = l?.name ?? "Launch not found";
  const name = full.length > 28 ? `${full.slice(0, 27).trimEnd()}…` : full;
  const nameSize = name.length > 18 ? 76 : 96;
  const track = (px: number) => -Math.round(px * 0.045 * 10) / 10;
  const stats = !p && l?.launchDay
    ? [{ label: "12:01 AM Pacific", value: launchDayLabel(l.launchDay) }]
    : [
    { label: "today", value: p?.rank ? `#${p.rank}` : "Live" },
    { label: "upvotes", value: fmt(p?.votes ?? 0) },
    { label: "comments", value: fmt(p?.comments ?? 0) },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundImage: "radial-gradient(circle at 60% 0%, #f7e1e4 0%, #f1dbc3 55%, #eac39a 100%)",
          color: "#111111",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={52} height={52} alt="" />
          <div style={{ fontSize: 34, letterSpacing: track(34) }}>{!p && l?.launchDay ? "Launching on Product Hunt" : "Launch day on Product Hunt"}</div>
        </div>
        <div style={{ fontSize: nameSize, lineHeight: 1, letterSpacing: track(nameSize) }}>{name}</div>
        <div style={{ display: "flex", gap: 20 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", padding: "18px 28px", borderRadius: 24, background: "rgba(255,255,255,0.55)", minWidth: 240 }}>
              <div style={{ fontSize: 72, lineHeight: 1, letterSpacing: track(72) }}>{s.value}</div>
              <div style={{ fontSize: 28, color: "#5f5a53", marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Geist", data: font, weight: 600, style: "normal" }] },
  );
}
