import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { inviteDetails } from "./invite";

export const alt = "Invite to a Looper workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OG = path.join(process.cwd(), "src/app/invite/[token]/og");
const asset = (file: string) => readFile(path.join(OG, file));

/** Link preview for an invite, in the hirelooper.com hero style: warm wash, Geist SemiBold, frosted pill. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [details, font, logo] = await Promise.all([inviteDetails(token), asset("Geist-SemiBold.ttf"), asset("logo.png")]);
  const full = details?.ws.name ?? "";
  const name = full.length > 34 ? `${full.slice(0, 33).trimEnd()}…` : full;
  const line = details
    ? `${details.inviter ? `${details.inviter} invited you` : "You're invited"} to work with their AI loopers`
    : "Invite links last 14 days. Ask for a new one.";
  const nameSize = name.length > 24 ? 58 : name.length > 16 ? 72 : 92;
  // Geist SemiBold at the landing page's -0.045em; satori only takes px.
  const track = (px: number) => -Math.round(px * 0.045 * 10) / 10;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "radial-gradient(circle at 60% 0%, #f7e1e4 0%, #f1dbc3 55%, #eac39a 100%)",
          color: "#111111",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={68} height={68} alt="" />
          <div style={{ fontSize: 44, letterSpacing: track(44) }}>Looper</div>
        </div>
        {details ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 92, lineHeight: 1, letterSpacing: track(92) }}>Join</div>
            <div style={{ display: "flex", marginTop: 10, padding: "6px 28px 14px", borderRadius: 32, background: "rgba(255,255,255,0.5)", fontSize: nameSize, lineHeight: 1.08, letterSpacing: track(nameSize) }}>
              {name}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 84, lineHeight: 1, letterSpacing: track(84) }}>This invite expired</div>
        )}
        <div style={{ marginTop: 30, fontSize: 34, color: "#5f5a53", letterSpacing: track(34) / 2 }}>{line}</div>
        <div style={{ display: "flex", marginTop: 36, padding: "16px 30px", borderRadius: 16, background: "#111111", color: "#ffffff", fontSize: 28, letterSpacing: track(28) / 2 }}>
          {details ? "Accept invite" : "hirelooper.com"}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Geist", data: font, weight: 600, style: "normal" }] },
  );
}
