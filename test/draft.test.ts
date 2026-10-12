import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, kindOf, ROLES } from "../lib/roles.ts";
import { cardHow, cleanSkill, kindsOf, nextStep, ownWork, presetSkills, presetTools, stackFor, swap, toolsShown, trialKey, workLine, workOptions } from "../lib/draft-steps.ts";

const seo = ROLES.find((r) => r.id === "seo")!;
const custom = ROLES.find((r) => r.id === "custom")!;
const gsc = { name: "Search Console clicks, last 28 days", source: "google_search_console", hint: "", unit: "", direction: "up" as const };

test("the builder opens the first step without an answer", () => {
  assert.equal(nextStep({}), 1);
  assert.equal(nextStep({ metric: gsc }), 2);
  assert.equal(nextStep({ metric: gsc, work: seo.work[0] }), 3);
  assert.equal(nextStep({ metric: gsc, work: seo.work[0], tools: [] }), 4);
  assert.equal(nextStep({ metric: gsc, work: seo.work[0], tools: [], skills: presetSkills(seo, seo.work[0]) }), 5);
});

test("a skill's test run goes stale when what it does changes, not when it moves in the week", () => {
  const s = presetSkills(seo, seo.work[0])[0];
  assert.equal(trialKey(s), trialKey({ ...s, days: [5], hour: 17 }));
  assert.notEqual(trialKey(s), trialKey({ ...s, rules: s.rules + " One page only." }));
  assert.notEqual(trialKey(s), trialKey({ ...s, tool: "webflow" }));
});

test("a drafted card says what approving it does", () => {
  assert.equal(cardHow(null, "LOOPER_GITHUB_PR"), "You do it by hand");
  assert.equal(cardHow({ tool_slug: "LOOPER_GITHUB_PR", arguments: { repo: "a/site", files: [{}, {}] } }, "LOOPER_GITHUB_PR"), "Opens a pull request in a/site, 2 files");
  assert.equal(cardHow({ tool_slug: "GOOGLEADS_PAUSE", arguments: {} }, "LOOPER_GITHUB_PR"), "Runs GOOGLEADS_PAUSE when you approve");
});

test("every live role but your own has a unit of work, and its skills are its own presets", () => {
  for (const r of ROLES.filter((x) => x.live && x.id !== "custom")) {
    assert.ok(r.work.length, `${r.id} has no unit of work`);
    for (const w of r.work) for (const s of w.skills ?? []) assert.ok(r.routines.some((p) => p.slug === s), `${r.id}: ${s} is not a preset`);
  }
  assert.deepEqual(custom.work, []);
});

test("an SEO blog post starts from the three page-writing presets, a rewrite from the title one", () => {
  assert.deepEqual(presetSkills(seo, seo.work[0]).map((s) => s.slug), ["geo-gaps", "new-page", "refresh"]);
  assert.deepEqual(presetSkills(seo, seo.work[1]).map((s) => s.slug), ["striking-distance"]);
  // Published by hand: no preset fits, the model writes the skills.
  assert.deepEqual(presetSkills(seo, seo.work[2]), []);
});

test("tools: the metric's source, where the work ships, then what the role reads, without repeats", () => {
  const picks = presetTools(seo, { metric: gsc, work: seo.work[0] });
  assert.deepEqual(picks.map((p) => p.slug), ["google_search_console", "github"]);
  assert.match(picks[1].why, /blog post/);
  assert.deepEqual(presetTools(custom, { metric: { ...gsc, source: "manual" } }), []);
});

test("units of work come from the role, or from the model for your own looper", () => {
  assert.equal(workOptions(seo, { workOptions: [{ name: "A tweet", detail: "", action: "tool", tool: "twitter" }] }), seo.work);
  assert.equal(workOptions(custom, {}).length, 0);
  assert.equal(workLine({ name: "A case study", detail: "", action: "manual", tool: "" }), "A case study");
});

test("a hand-edited skill keeps days 0 to 6 and hours 6 to 18, and needs a name and rules", () => {
  const base = { name: "Write a post", tool: "github", days: [2], hour: 10, rules: "max: 1", action: "github_pr" as const, input: "query" };
  assert.deepEqual(cleanSkill({ name: " Write two ", rules: "max: 2", days: [4, 1, 9, 1], hour: 23 }, base), {
    ...base,
    name: "Write two",
    rules: "max: 2",
    days: [1, 4],
    hour: 18,
  });
  assert.deepEqual(cleanSkill({ name: "x", rules: "y", days: [] }, base)?.days, [2]);
  assert.equal(cleanSkill({ name: "", rules: "y" }, base), null);
});

test("a typed unit of work that names a pull request ships as one through GitHub, the rest by hand", () => {
  assert.deepEqual(ownWork("A use case page, opened as a GitHub pull request"), { name: "A use case page, opened as a GitHub pull request", detail: "", action: "github_pr", tool: "github" });
  assert.equal(ownWork("A landing page as a PR").action, "github_pr");
  assert.equal(ownWork("A case study of one customer").action, "manual");
  // "PR" inside a word is not a pull request.
  assert.equal(ownWork("A PRice test email").action, "manual");
  assert.deepEqual(presetTools(custom, { metric: gsc, work: ownWork("A page as a pull request") }).map((p) => p.slug), ["google_search_console", "github"]);
});

const support = ROLES.find((r) => r.id === "support")!;
const outreach = ROLES.find((r) => r.id === "outreach")!;

test("a support looper runs on the founder's own help desk: the metric, the replies and the node", () => {
  const firstReply = { ...support.metrics[0], source: "crisp" };
  const picks = presetTools(support, { metric: firstReply, work: support.work[0], stack: { helpdesk: "crisp" } });
  assert.deepEqual(picks.map((p) => p.slug), ["crisp"]);
  assert.equal(picks[0].kind, "helpdesk");
  assert.deepEqual(toolsShown(support, new Set(["crisp"])), ["crisp", "gmail"]);
  assert.deepEqual(toolsShown(support, new Set()), support.tools);
});

test("a custom connector stands in for a kind, and a default with no pick stays", () => {
  const stack = { helpdesk: "x_desk" };
  const picks = presetTools(support, { metric: { ...support.metrics[0], source: "x_desk" }, work: support.work[0], stack });
  assert.deepEqual(picks, [{ slug: "x_desk", why: "Reads the metric every morning", kind: "helpdesk" }]);
  assert.equal(swap("gmail", stack), "gmail");
  assert.equal(swap("github", { issues: "jira" }), "github");
});

test("the stack keeps the founder's picks and fills the other kinds from connected tools", () => {
  assert.deepEqual(stackFor(outreach, new Set(["pipedrive", "outlook", "attio"]), { crm: "attio" }), { crm: "attio", email: "outlook" });
  assert.deepEqual(kindsOf(outreach).sort(), ["crm", "email"]);
  const picks = presetTools(outreach, { metric: outreach.metrics[0], work: outreach.work[0], stack: { crm: "pipedrive", email: "outlook" } });
  assert.deepEqual(picks.map((p) => p.slug), ["pipedrive", "outlook"]);
});

test("kinds: a tool does one job, GitHub does none, and a swappable metric never names a product", () => {
  const all = Object.values(KINDS).flatMap((k) => k.tools);
  assert.equal(new Set(all).size, all.length);
  assert.equal(kindOf("github"), undefined);
  for (const r of ROLES.filter((x) => x.id !== "custom"))
    for (const m of r.metrics.filter((x) => kindOf(x.source)))
      for (const t of KINDS[kindOf(m.source)!].tools) assert.ok(!m.name.toLowerCase().includes(t.replace("_", " ")), `${r.id}: "${m.name}" names ${t}`);
});
