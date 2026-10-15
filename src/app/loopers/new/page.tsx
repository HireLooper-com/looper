"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLooper } from "@/app/actions";
import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";

const EMOJI = ["◎", "📈", "✉️", "🎯", "⚡️", "🧲", "🛠️", "💬", "🌱", "🔭"];

export default function NewLooper() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [emoji, setEmoji] = useState(EMOJI[0]);

  return (
    <div className="mx-auto max-w-2xl pt-10">
      <h1 className="display text-[2.5rem]">Hire a looper</h1>
      <p className="mt-3 text-[0.9375rem] text-mute">Pick one number this looper is responsible for. Add skills on its page after hiring, or let Chief draft everything for you.</p>

      <Panel className="mt-8 p-6">
        <form
          className="grid gap-5"
          action={(fd) =>
            start(async () => {
              const id = await createLooper({
                name: String(fd.get("name")),
                emoji,
                mission: String(fd.get("mission")),
                metricName: String(fd.get("metricName")),
                unit: String(fd.get("unit")),
                direction: fd.get("direction") as "up" | "down",
                target: Number(fd.get("target")),
                current: fd.get("current") === "" ? undefined : Number(fd.get("current")),
                apps: String(fd.get("apps") ?? "").split(",").map((a) => a.trim()).filter(Boolean),
              });
              router.push(`/loopers/${id}?tab=apps`);
            })
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {EMOJI.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setEmoji(e)}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[1.1rem] ${emoji === e ? "bg-blue text-white" : "bg-[#ebebf0]"}`}
              >
                {e}
              </button>
            ))}
          </div>
          <Field label="Name">
            <Input name="name" required placeholder="Ivy" />
          </Field>
          <Field label="Mission" hint="What this looper does, in a sentence or two.">
            <Textarea name="mission" required rows={3} placeholder="Grow LinkedIn reach for the founder by publishing and repurposing posts daily." />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="The one metric">
              <Input name="metricName" required placeholder="LinkedIn impressions" />
            </Field>
            <Field label="Unit">
              <Input name="unit" required placeholder="per week" />
            </Field>
            <Field label="Direction">
              <Select name="direction" defaultValue="up">
                <option value="up">Higher is better</option>
                <option value="down">Lower is better</option>
              </Select>
            </Field>
            <Field label="Target">
              <Input name="target" type="number" step="any" required placeholder="50000" />
            </Field>
            <Field label="Current value" hint="Optional baseline">
              <Input name="current" type="number" step="any" placeholder="12000" />
            </Field>
          </div>
          <Field label="Apps it works with" hint="Comma-separated. You'll connect each one with a click on the next screen.">
            <Input name="apps" placeholder="bunq, Stripe, Gmail" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Hiring…" : "Hire looper"}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
