import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { inviteDetails } from "./invite";

export const alt = "Invite to a Looper workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link preview for an invite: whose workspace, who sent it. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [details, icon] = await Promise.all([inviteDetails(token), readFile(path.join(process.cwd(), "src/app/icon.png"), "base64")]);
  const title = details ? `Join ${details.ws.name}` : "This invite expired";
  const line = details
    ? `${details.inviter ? `${details.inviter} invited you` : "You're invited"} to work with the AI loopers in this workspace.`
    : "Invite links last 14 days. Ask whoever sent it for a new one.";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#f5f5f7", color: "#1d1d1f" }}>
        <img src={`data:image/png;base64,${icon}`} width={112} height={112} alt="" style={{ borderRadius: 26 }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: title.length > 26 ? 64 : 84, letterSpacing: "-0.035em", lineHeight: 1.05 }}>{title}</div>
          <div style={{ marginTop: 24, fontSize: 36, lineHeight: 1.3, color: "#6e6e73", maxWidth: 1040 }}>{line}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#6e6e73" }}>
          <span style={{ color: "#1d1d1f" }}>Looper</span>
          <span style={{ margin: "0 14px" }}>·</span>
          <span>Hire AI loopers that drive your business metrics</span>
        </div>
      </div>
    ),
    size,
  );
}
