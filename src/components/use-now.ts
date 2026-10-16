"use client";

import { useSyncExternalStore } from "react";

// Current time, rounded to the minute and ticking once a minute. 0 during server rendering,
// so pages never read the clock while Next prerenders them.
const subscribe = (cb: () => void) => {
  const t = setInterval(cb, 60_000);
  return () => clearInterval(t);
};
const snapshot = () => Math.floor(Date.now() / 60_000) * 60_000;

export function useNow() {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
