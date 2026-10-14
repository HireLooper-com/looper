// Demo data so you can see the boards before your loopers have run. Usage: npm run seed
// Overwrites data/db.json but keeps any saved settings (keys, integrations).
import fs from "node:fs";

const FILE = "data/db.json";
const now = Date.now();
const d = 864e5;
const iso = (t) => new Date(t).toISOString();
const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
const skill = (id, name, instructions, type, time, days = [1], kind = "work") => ({ id, name, instructions, kind, schedule: { type, time, days } });
const looper = (id, name, emoji, color, mission, metric, skills) => ({ id, name, emoji, color, mission, metric, skills, integrationIds: "all", status: "paused", createdAt: iso(now - 20 * d) });

const db = {
  settings: prev.settings ?? {
    provider: "xai",
    apiKeys: {},
    models: { xai: "grok-4.7", openai: "gpt-5.6", anthropic: "claude-sonnet-5-5" },
    integrations: [],
  },
  loopers: [
    looper("ivy", "Ivy", "📈", "green", "Grow the founder's LinkedIn reach by publishing, repurposing and engaging daily.",
      { name: "LinkedIn impressions", unit: "per week", direction: "up", target: 50000, history: [12000, 13100, 12800, 14500, 15900, 17200, 18400].map((value, i) => ({ at: iso(now - (6 - i) * d), value, note: "LinkedIn analytics" })) },
      [skill("s1", "Draft & schedule post", "Pick the strongest idea from the Notion idea bank, write a LinkedIn post, and schedule it in Buffer for 9:30.", "daily", "09:00"),
       skill("s2", "Engage with comments", "Reply to new comments on this week's LinkedIn posts.", "daily", "16:00"),
       skill("s3", "Weekly retro", "Reflect on the week's work against the metric.", "weekly", "17:00", [5], "retro")]),
    looper("max", "Max", "🎯", "orange", "Book qualified demo calls from inbound and outbound leads.",
      { name: "Qualified demos", unit: "per week", direction: "up", target: 10, history: [4, 5, 5, 7].map((value, i) => ({ at: iso(now - (3 - i) * 2 * d), value })) },
      [skill("s4", "Lead follow-up", "Follow up open HubSpot leads by Gmail and log replies.", "weekly", "10:00", [1, 3, 5]),
       skill("s5", "Weekly retro", "Reflect on the week's work against the metric.", "weekly", "17:00", [5], "retro")]),
    looper("sol", "Sol", "💬", "lavender", "Keep support fast and friendly across Crisp and email.",
      { name: "First response time", unit: "min", direction: "down", target: 60, history: [180, 150, 120, 95].map((value, i) => ({ at: iso(now - (3 - i) * d), value })) },
      [skill("s6", "Triage inbox", "Triage new Crisp conversations and draft replies.", "hourly", "00:15")]),
  ],
  cards: [["ivy", "Repurpose podcast into 3 posts", "todo"], ["ivy", "Test carousel format", "doing"], ["ivy", "Post: hiring loopers thread", "done"], ["ivy", "Collect top-performing hooks", "backlog"], ["ivy", "Reply to 20 comments on viral post", "done"], ["max", "Clean up stale HubSpot deals", "todo"]]
    .map(([looperId, title, column], i) => ({ id: `c${i}`, looperId, title, description: "", column, createdBy: i % 2 ? "looper" : "chief", createdAt: iso(now - i * d), updatedAt: iso(now - i * 36e5) })),
  runs: Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`, looperId: "ivy", skillId: i % 3 ? "s1" : "s2", skillName: i % 3 ? "Draft & schedule post" : "Engage with comments", trigger: "schedule",
    status: i === 4 ? "error" : "success", startedAt: iso(now - (i + 1) * d), finishedAt: iso(now - (i + 1) * d + 6e4),
    summary: i === 4 ? "Buffer rejected the request: token expired." : "Drafted a post on carousel learnings from the Notion idea bank and scheduled it in Buffer for 9:30.",
    toolCalls: [{ name: "NOTION_SEARCH", ok: true }, { name: "BUFFER_CREATE_POST", ok: i !== 4 }, { name: "kanban_move_card", ok: true }],
  })),
  retros: [{ id: "rt1", looperId: "ivy", createdAt: iso(now - d), periodStart: iso(now - 8 * d), periodEnd: iso(now - d), effectiveness: 4, metricStart: 12000, metricEnd: 18400,
    wentWell: ["Daily posting cadence held 7/7 days", "Carousel post drove 41% of weekly impressions"],
    didntGoWell: ["Comment replies lagged >6h on two days", "One Buffer run failed on an expired token"],
    tryNext: ["Reply to comments within 2h of posting", "Two carousels per week", "Reuse top-3 hooks from last month"] }],
  chief: [],
};

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(db, null, 2), { mode: 0o600 });
console.log("Seeded 3 demo loopers (paused, so they won't run until you resume them).");
