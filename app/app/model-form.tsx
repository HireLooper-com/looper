"use client";

import { useState } from "react";
import { saveModel, wantModelPlan } from "../actions";
import { Form, Submit } from "../ui";
import { PROVIDERS } from "@/lib/models";

const KEYS = [
  { id: "anthropic", name: "Claude", by: "Anthropic API key", model: "claude-opus-5-5", hint: "sk-ant-..." },
  { id: "openai", name: "OpenAI", by: "OpenAI API key", model: "gpt-5", hint: "sk-..." },
  { id: "xai", name: "Grok", by: "xAI API key", model: "grok-4", hint: "xai-..." },
] as const;

const PLANS = [
  { id: "chatgpt", name: "ChatGPT plan" },
  { id: "grok", name: "Grok plan" },
  { id: "cursor", name: "Cursor plan" },
];

/** Onboarding: the founder's AI. An API key today; plan sign-in records interest until OpenAI, xAI and Cursor open it. */
export default function ModelStep() {
  const [p, setP] = useState<(typeof KEYS)[number]["id"]>("anthropic");
  const k = KEYS.find((x) => x.id === p)!;
  return (
    <>
      <Form action={saveModel} className="xset-c">
        <div className="xk xb-prov" role="radiogroup" aria-label="Provider">
          {KEYS.map((x) => (
            <label className="xk-c" key={x.id}>
              <input type="radio" name="provider" value={x.id} checked={p === x.id} onChange={() => setP(x.id)} />
              <span className="xset-t">
                <b>{x.name}</b>
                <small>{x.by}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="row2">
          <div>
            <label htmlFor="key">API key</label>
            <input id="key" name="key" type="password" autoComplete="off" required placeholder={k.hint} autoFocus />
          </div>
          <div>
            <label htmlFor="model">Model</label>
            <select id="model" name="model" key={k.id} defaultValue={k.model}>
              {PROVIDERS[k.id].models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="xset-act">
          <Submit busy="Checking the key">Connect</Submit>
          <span className="note">One 1-word request checks the key. Stored encrypted; you pay your provider for tokens, not us.</span>
        </div>
      </Form>
      <Form action={wantModelPlan} className="xset-c xset-add">
        <h3>Use a ChatGPT, Grok or Cursor plan</h3>
        <p className="dim">OpenAI, xAI and Cursor do not let other apps sign in with a plan yet. Tell us which one you use; it decides which sign-in we build first.</p>
        <div className="xset-act">
          {PLANS.map((x) => (
            <button key={x.id} className="btn2 sm" type="submit" name="plan" value={x.id}>
              {x.name}
            </button>
          ))}
        </div>
      </Form>
    </>
  );
}
