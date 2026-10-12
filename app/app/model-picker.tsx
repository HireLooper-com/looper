"use client";

import { useState } from "react";
import { PROVIDERS, type Provider } from "@/lib/models";

/** Provider and model dropdowns, plus the key field; the model list follows the provider. */
export default function ModelPicker({ provider, model }: { provider?: Provider; model?: string }) {
  const [p, setP] = useState<Provider>(provider ?? "anthropic");
  const [m, setM] = useState(model && PROVIDERS[p].models.includes(model) ? model : PROVIDERS[p].model);
  return (
    <div className="xset-g3">
      <div>
        <label htmlFor="provider">Provider</label>
        <select
          id="provider"
          name="provider"
          value={p}
          onChange={(e) => {
            const next = e.target.value as Provider;
            setP(next);
            setM(PROVIDERS[next].model);
          }}
        >
          {(Object.keys(PROVIDERS) as Provider[]).map((id) => (
            <option key={id} value={id}>{PROVIDERS[id].name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="model">Model</label>
        <select id="model" name="model" value={m} onChange={(e) => setM(e.target.value)}>
          {PROVIDERS[p].models.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="key">API key</label>
        <input id="key" name="key" type="password" autoComplete="off" required placeholder={PROVIDERS[p].hint} />
      </div>
    </div>
  );
}
