import { TOOLKITS } from "@/lib/composio";
import { LOGOS } from "@/lib/logos";
import { role as findRole } from "@/lib/roles";
import { Logo } from "../logo";

// Your own loopers get one of these, picked by looper id so each keeps its colors.
const OWN = [
  ["own-1", "#8F6BFF"],
  ["own-2", "#4FD6B0"],
  ["own-3", "#FF5A4A"],
  ["own-4", "#7ED957"],
  ["own-5", "#E04BC8"],
  ["own-6", "#E8A0A0"],
] as const;

/** The looper's glossy figure eight from public/loopers. Your own looper gets a colorway by `id`; without one (not hired yet) it shows the plain logo. */
export function Avatar({ roleId, id, size = 44 }: { roleId: string; id?: number; size?: number }) {
  const r = findRole(roleId);
  const [img, glow] = r?.avatar ? [r.avatar, r.colors[1]] : id ? OWN[id % OWN.length] : [null, null];
  if (!img)
    return (
      <span className="xav xav-own" style={{ width: size, height: size }} aria-hidden="true">
        <Logo />
      </span>
    );
  return (
    <span
      className="xav"
      aria-hidden="true"
      style={{ width: size, height: size, backgroundImage: `url(/loopers/${img}.webp)`, ["--b" as string]: glow }}
    />
  );
}

/** A tool's logo in a round chip, named for screen readers and on hover. */
export function ToolIcon({ slug, name: given }: { slug: string; name?: string }) {
  const name = given ?? TOOLKITS[slug] ?? slug;
  const svg = LOGOS[slug];
  return (
    <span className="xti" role="img" aria-label={name} title={name}>
      {svg ? <span dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", '<svg aria-hidden="true" ') }} /> : name[0]}
    </span>
  );
}
