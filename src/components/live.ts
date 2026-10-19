"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Job, Progress } from "@/lib/progress";

// Live state from GET routes. Polling goes through fetch, not server actions: actions run one at a
// time per tab, so polling through them would wait behind any long request.

const fresh = (p: Progress | null) => !!p && !p.done && Date.now() - p.since < 6 * 60_000;

/**
 * Follow a reply or run. Polls while it's working, or while we're waiting for one that started at
 * `expectSince` (server time) to show up. Returns the latest progress and whether it's still going.
 */
export function useProgress(target: string | null, expectSince = 0, onFinish?: (p: Progress) => void) {
  const [p, setP] = useState<Progress | null>(null);
  const finish = useRef(onFinish);
  useEffect(() => {
    finish.current = onFinish;
  });
  useEffect(() => {
    if (!target) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedWaiting = Date.now();
    const tick = async () => {
      const next: Progress | null = await fetch(`/api/progress?target=${encodeURIComponent(target)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!alive) return;
      setP(next);
      if (next?.done && expectSince > 0 && next.since >= expectSince) finish.current?.(next);
      const waiting = expectSince > 0 && (!next || next.since < expectSince) && Date.now() - startedWaiting < 60_000;
      if (fresh(next) || waiting) timer = setTimeout(tick, next?.draft ? 450 : 800);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [target, expectSince]);
  const current = p && (!expectSince || p.since >= expectSince) ? p : null;
  const working = fresh(current) || (expectSince > 0 && !current);
  return { progress: current, working, finished: !!current?.done };
}

// — Background work across the app: one poller shared by the rail tray and the notices —

export type ActiveJob = Job & { step?: string };
let jobs: ActiveJob[] = [];
let state: { jobs: ActiveJob[]; loaded: boolean } = { jobs, loaded: false };
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
// Right after you start something, check often so its first step and its end show quickly.
let boostUntil = 0;
const listeners = new Set<() => void>();

async function poll() {
  clearTimeout(timer);
  if (!document.hidden) {
    jobs = await fetch("/api/activity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { jobs }))
      .then((r: { jobs: ActiveJob[] }) => r.jobs)
      .catch(() => jobs);
    state = { jobs, loaded: true };
    listeners.forEach((l) => l());
  }
  const busy = jobs.some((j) => !j.finishedAt) || Date.now() < boostUntil;
  timer = setTimeout(poll, busy ? 1500 : 8000);
}

/** Call after starting background work: polls now and briskly for the next half minute. */
export function refreshActivity() {
  boostUntil = Date.now() + 30_000;
  if (started) void poll();
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!started) {
    started = true;
    void poll();
  }
  return () => {
    listeners.delete(l);
  };
}

/** Background jobs, plus whether the first check has come back (so old finishes aren't news). */
export function useActivityState() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

export function useActivity(): ActiveJob[] {
  return useActivityState().jobs;
}
const SERVER_STATE = { jobs: [] as ActiveJob[], loaded: false };
