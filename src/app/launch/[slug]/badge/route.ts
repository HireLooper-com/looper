import { connection } from "next/server";
import { getLaunch } from "@/lib/launch";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A small live badge for a maker's site or README: "▲ 412 · #3 today". */
export async function GET(_: Request, { params }: RouteContext<"/launch/[slug]/badge">) {
  await connection();
  const { slug } = await params;
  const l = await getLaunch(slug);
  if (!l?.uid) return new Response("Not found", { status: 404 });
  const p = l.points.at(-1);
  const right = `▲ ${(p?.votes ?? 0).toLocaleString("en-US")}${p?.rank ? `  ·  #${p.rank} today` : ""}`;
  const left = "Live on Product Hunt";
  // Rough text widths for 13px system UI; enough to size the pill without measuring fonts.
  const lw = Math.round(left.length * 7.2) + 28;
  const rw = Math.round(right.length * 7.6) + 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="40" viewBox="0 0 ${lw + rw} 40" role="img" aria-label="${esc(`${l.name}: ${right}`)}">
<rect width="${lw + rw}" height="40" rx="12" fill="#1d1d1f"/>
<rect x="${lw}" width="${rw}" height="40" rx="12" fill="#ffffff"/>
<rect x="${lw}" width="12" height="40" fill="#ffffff"/>
<rect x="0.5" y="0.5" width="${lw + rw - 1}" height="39" rx="11.5" fill="none" stroke="#1d1d1f"/>
<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-size="13" font-weight="600">
<text x="14" y="25" fill="#ffffff">${left}</text>
<text x="${lw + 14}" y="25" fill="#1d1d1f">${esc(right)}</text>
</g>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=120, s-maxage=120" } });
}
