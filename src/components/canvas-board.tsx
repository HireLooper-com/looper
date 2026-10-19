"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { askLooper } from "@/app/actions";
import { getCanvas, linkPreview, patchCanvas } from "@/app/canvas-actions";
import type { Accent, CanvasItem } from "@/lib/types";
import { refreshActivity, useProgress } from "./live";
import { Bot, cx } from "./ui";

type View = { x: number; y: number; z: number };
type Gesture =
  | { type: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { type: "move"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; kids: { id: string; ox: number; oy: number }[] }
  | { type: "resize"; id: string; sx: number; sy: number; ow: number; oh: number; ratio?: number }
  | { type: "connect"; from: string };

const MIN_Z = 0.1;
const MAX_Z = 4;
const SIZES: Record<CanvasItem["kind"], { w: number; h: number }> = {
  note: { w: 220, h: 200 },
  text: { w: 320, h: 80 },
  image: { w: 320, h: 240 },
  link: { w: 300, h: 96 },
  frame: { w: 560, h: 360 },
  arrow: { w: 0, h: 0 },
};
const solid = (i: CanvasItem) => i.kind !== "arrow";
/** Items lying fully inside a frame move with it. */
const inside = (f: CanvasItem, i: CanvasItem) => i.id !== f.id && solid(i) && i.kind !== "frame" && i.x >= f.x && i.y >= f.y && i.x + i.w <= f.x + f.w && i.y + i.h <= f.y + f.h;

/** Where the line from a's centre towards b leaves a's box. */
function edgePoint(a: CanvasItem, b: CanvasItem) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = b.x + b.w / 2 - cx;
  const dy = b.y + b.h / 2 - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(Math.abs(a.w / 2 / (dx || 1e-9)), Math.abs(a.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * t, y: cy + dy * t };
}
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));
const now = () => new Date().toISOString();
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const isImageUrl = (s: string) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i.test(s.trim());
const host = (u?: string) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : "";
  } catch {
    return u ?? "";
  }
};

/** Shrink big photos before upload: a canvas reference doesn't need 12 megapixels. */
async function downsize(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 900_000) return file;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const encode = (type: string) => new Promise<Blob | null>((r) => c.toBlob(r, type, 0.85));
  const webp = await encode("image/webp");
  return webp?.type === "image/webp" ? webp : ((await encode("image/jpeg")) ?? file);
}

function naturalSize(src: string) {
  return new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(SIZES.image);
    img.src = src;
  });
}

/** The nearest spot to `at` (an item's centre) where a w×h item doesn't cover anything. */
function freeSpot(items: CanvasItem[], at: { x: number; y: number }, w: number, h: number) {
  const gap = 24;
  const hits = (x: number, y: number) => items.some((i) => solid(i) && x < i.x + i.w + gap && x + w + gap > i.x && y < i.y + i.h + gap && y + h + gap > i.y);
  const x0 = at.x - w / 2;
  const y0 = at.y - h / 2;
  for (let ring = 0; ring < 40; ring++) {
    const d = ring * 40;
    for (const [dx, dy] of ring ? [[d, 0], [0, d], [d, d], [-d, 0], [0, -d], [-d, d], [d, -d], [-d, -d]] : [[0, 0]]) {
      if (!hits(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
    }
  }
  return { x: x0, y: y0 };
}

/** Fit an image into a reasonable first size while keeping its shape. */
function imageBox(n: { w: number; h: number }) {
  const s = Math.min(1, 360 / n.w, 360 / n.h);
  return { w: Math.max(80, Math.round(n.w * s)), h: Math.max(60, Math.round(n.h * s)) };
}

export function CanvasBoard({ looper, running }: { looper: { id: string; name: string; color?: Accent }; running: boolean }) {
  const [items, setItems] = useState<CanvasItem[] | null>(null);
  const [view, setView] = useState<View>({ x: 80, y: 80, z: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [linkBox, setLinkBox] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  // "Build a board" runs as a chat reply in the background; follow it and pull pins in as they land.
  const [buildSince, setBuildSince] = useState(0);
  const { working: building, progress: buildProgress } = useProgress(buildSince ? `chat:${looper.id}` : null, buildSince);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const itemsRef = useRef<CanvasItem[]>([]);
  const viewRef = useRef(view);
  const fitted = useRef<boolean | "empty">(false);
  // Unsaved edits, sent in one batch shortly after the last change.
  const dirty = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    itemsRef.current = items ?? [];
  }, [items]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  /** Server state wins, except for what the owner changed since the last save. */
  const merge = useCallback((server: CanvasItem[]) => {
    setItems((prev) => {
      const local = new Map((prev ?? []).map((i) => [i.id, i]));
      const next = server.filter((i) => !removed.current.has(i.id)).map((i) => (dirty.current.has(i.id) ? (local.get(i.id) ?? i) : i));
      for (const id of dirty.current) if (!next.some((i) => i.id === id) && local.has(id)) next.push(local.get(id)!);
      return next;
    });
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current.size && !removed.current.size) return;
    const upsert = itemsRef.current.filter((i) => dirty.current.has(i.id) && !i.src?.startsWith("blob:"));
    const remove = [...removed.current];
    upsert.forEach((i) => dirty.current.delete(i.id));
    removed.current.clear();
    const res = await patchCanvas(looper.id, { upsert, remove });
    if (res.ok) merge(res.canvas.items);
    else {
      upsert.forEach((i) => dirty.current.add(i.id));
      remove.forEach((id) => removed.current.add(id));
      setNotice(res.error);
    }
  }, [looper.id, merge]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }, [flush]);

  const change = useCallback(
    (id: string, patch: Partial<CanvasItem>) => {
      setItems((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)));
      dirty.current.add(id);
      schedule();
    },
    [schedule],
  );

  const add = useCallback(
    (item: Omit<CanvasItem, "id" | "by" | "at"> & { id?: string }, avoid = true) => {
      // Toolbar, paste and upload aim at the middle of the view; nudge to free space so nothing gets buried.
      const spot = avoid ? freeSpot(itemsRef.current, { x: item.x + item.w / 2, y: item.y + item.h / 2 }, item.w, item.h) : { x: item.x, y: item.y };
      const full: CanvasItem = { id: item.id ?? nanoid(8), by: "you", at: now(), ...item, ...spot };
      itemsRef.current = [...itemsRef.current, full];
      setItems((prev) => [...(prev ?? []), full]);
      dirty.current.add(full.id);
      schedule();
      return full;
    },
    [schedule],
  );

  const remove = useCallback(
    (id: string) => {
      const attached = itemsRef.current.filter((i) => i.kind === "arrow" && (i.from === id || i.to === id)).map((i) => i.id);
      for (const x of [id, ...attached]) {
        dirty.current.delete(x);
        removed.current.add(x);
      }
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id && !attached.includes(i.id)));
      setSelected((s) => (s === id ? null : s));
      schedule();
    },
    [schedule],
  );

  // Load, then keep up with what the looper pins: often while it runs, otherwise when you come back.
  useEffect(() => {
    let alive = true;
    const load = () =>
      getCanvas(looper.id)
        .then((c) => alive && merge(c.items))
        .catch((e) => alive && setNotice(String(e?.message ?? e)));
    load();
    const t = running || building ? setInterval(load, 3000) : undefined;
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      if (t) clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [looper.id, running, building, merge]);

  // Save what's pending when leaving the tab.
  useEffect(() => () => void flush(), [flush]);

  const toCanvas = useCallback((cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  }, []);

  const center = useCallback(() => {
    const r = box.current!.getBoundingClientRect();
    return toCanvas(r.left + r.width / 2, r.top + r.height / 2);
  }, [toCanvas]);

  const fit = useCallback((all: CanvasItem[]) => {
    const list = all.filter(solid);
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    if (!list.length) return setView({ x: r.width / 2 - 110, y: r.height / 2 - 100, z: 1 });
    const minX = Math.min(...list.map((i) => i.x));
    const minY = Math.min(...list.map((i) => i.y));
    const maxX = Math.max(...list.map((i) => i.x + i.w));
    const maxY = Math.max(...list.map((i) => i.y + i.h));
    const z = clampZ(Math.min(1, (r.width - 120) / (maxX - minX), (r.height - 160) / (maxY - minY)));
    setView({ x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (r.height - 60 - (maxY - minY) * z) / 2 - minY * z, z });
  }, []);

  // Frame everything the first time the canvas loads, and when a board appears on an empty canvas.
  useEffect(() => {
    if (items && (!fitted.current || (fitted.current === "empty" && items.length))) {
      fitted.current = items.length ? true : "empty";
      fit(items);
    }
  }, [items, fit]);

  const zoomAt = useCallback((factor: number, sx?: number, sy?: number) => {
    const r = box.current!.getBoundingClientRect();
    const px = sx === undefined ? r.width / 2 : sx - r.left;
    const py = sy === undefined ? r.height / 2 : sy - r.top;
    setView((v) => {
      const z = clampZ(v.z * factor);
      return { z, x: px - ((px - v.x) * z) / v.z, y: py - ((py - v.y) * z) / v.z };
    });
  }, []);

  // Trackpad: two fingers pan, pinch (ctrl+wheel) zooms. Mouse wheel pans; ⌘/ctrl+wheel zooms.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const uploadImages = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      let p = at ?? center();
      for (const file of files.filter((f) => f.type.startsWith("image/"))) {
        const local = URL.createObjectURL(file);
        const size = imageBox(await naturalSize(local));
        const item = add({ kind: "image", x: p.x - size.w / 2, y: p.y - size.h / 2, ...size, src: local });
        p = { x: p.x + 32, y: p.y + 32 };
        try {
          const body = new FormData();
          body.append("file", await downsize(file), file.name);
          const res = await fetch(`/api/canvas/${looper.id}/image`, { method: "POST", body });
          const out = (await res.json()) as { src?: string; error?: string };
          if (!out.src) throw new Error(out.error ?? "Upload failed");
          change(item.id, { src: out.src });
        } catch (e) {
          remove(item.id);
          setNotice(e instanceof Error ? e.message : "Upload failed");
        }
      }
    },
    [add, change, remove, center, looper.id],
  );

  const addLink = useCallback(
    async (url: string, at?: { x: number; y: number }) => {
      const p = at ?? center();
      if (isImageUrl(url)) {
        const size = imageBox(await naturalSize(url));
        add({ kind: "image", x: p.x - size.w / 2, y: p.y - size.h / 2, ...size, src: url.trim() });
        return;
      }
      const item = add({ kind: "link", x: p.x - SIZES.link.w / 2, y: p.y - SIZES.link.h / 2, ...SIZES.link, url: url.trim() });
      const meta = await linkPreview(url).catch(() => null);
      if (meta) change(item.id, { url: meta.url, title: meta.title, image: meta.image });
    },
    [add, change, center],
  );

  const addText = useCallback(
    (kind: "note" | "text" | "frame", at?: { x: number; y: number }, text = "") => {
      const p = at ?? center();
      const s = SIZES[kind];
      const item = add({ kind, x: p.x - s.w / 2, y: p.y - s.h / 2, ...s, text }, !at);
      setSelected(item.id);
      if (!text) setEditing(item.id);
    },
    [add, center],
  );

  /** Ask the looper to lay out a board; its pins appear as it works. */
  const build = useCallback(
    (what: string) => {
      askLooper(looper.id, `Build a board on your canvas: ${what}. Use frames to group things and arrows where things relate. Tell me briefly what you pinned.`)
        .then((r) => {
          setBuildSince((r as { since?: number }).since || Date.now() - 1000);
          refreshActivity();
        })
        .catch((e) => setNotice(String(e?.message ?? e)));
    },
    [looper.id],
  );

  // Pull the finished board in when the reply is saved.
  const wasBuilding = useRef(false);
  useEffect(() => {
    if (wasBuilding.current && !building) getCanvas(looper.id).then((c) => merge(c.items)).catch(() => undefined);
    wasBuilding.current = building;
  }, [building, looper.id, merge]);

  // Paste images, links or text straight onto the canvas.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (files.length) void uploadImages(files);
      else if (isUrl(text)) void addLink(text);
      else if (text) addText("note", undefined, text);
      else return;
      e.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [uploadImages, addLink, addText]);

  // Delete, duplicate, deselect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (!selected) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        remove(selected);
      } else if (e.key === "Escape") setSelected(null);
      else if (e.key === "Enter") {
        const it = itemsRef.current.find((i) => i.id === selected);
        if (it && it.kind !== "link" && it.kind !== "arrow") {
          e.preventDefault();
          setEditing(it.id);
        }
      } else if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const it = itemsRef.current.find((i) => i.id === selected);
        if (it && it.kind !== "arrow") {
          setSelected(add({ kind: it.kind, w: it.w, h: it.h, text: it.text, src: it.src, url: it.url, title: it.title, image: it.image, x: it.x + 24, y: it.y + 24 }, false).id);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, remove, add]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-ui]")) return;
    const handle = target.closest<HTMLElement>("[data-resize]");
    const connector = target.closest<HTMLElement>("[data-connect]");
    const arrow = target.closest<SVGElement>("[data-arrow]");
    const el = target.closest<HTMLElement>("[data-item]");
    if (arrow) {
      setSelected(arrow.dataset.arrow ?? null);
      setEditing(null);
      return;
    }
    if (connector && el) {
      box.current!.setPointerCapture(e.pointerId);
      gesture.current = { type: "connect", from: el.dataset.item! };
      const p = toCanvas(e.clientX, e.clientY);
      setWire({ from: el.dataset.item!, ...p });
      return;
    }
    if (el && editing === el.dataset.item && !handle) return; // typing: let the textarea have it
    setLinkBox(null);
    box.current!.setPointerCapture(e.pointerId);
    if (el && e.button === 0) {
      const it = itemsRef.current.find((i) => i.id === el.dataset.item);
      if (!it) return;
      setSelected(it.id);
      if (editing && editing !== it.id) setEditing(null);
      gesture.current = handle
        ? { type: "resize", id: it.id, sx: e.clientX, sy: e.clientY, ow: it.w, oh: it.h, ratio: it.kind === "image" ? it.w / it.h : undefined }
        : {
            type: "move",
            id: it.id,
            sx: e.clientX,
            sy: e.clientY,
            ox: it.x,
            oy: it.y,
            moved: false,
            kids: it.kind === "frame" ? itemsRef.current.filter((k) => inside(it, k)).map((k) => ({ id: k.id, ox: k.x, oy: k.y })) : [],
          };
    } else {
      setSelected(null);
      setEditing(null);
      gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.type === "connect") {
      const p = toCanvas(e.clientX, e.clientY);
      return setWire({ from: g.from, ...p });
    }
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (g.type === "pan") return setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
    const z = viewRef.current.z;
    if (g.type === "move") {
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      const kids = new Map(g.kids.map((k) => [k.id, k]));
      setItems((prev) =>
        (prev ?? []).map((i) => {
          if (i.id === g.id) return { ...i, x: g.ox + dx / z, y: g.oy + dy / z };
          const k = kids.get(i.id);
          return k ? { ...i, x: k.ox + dx / z, y: k.oy + dy / z } : i;
        }),
      );
    } else {
      const w = Math.max(60, g.ow + dx / z);
      const h = g.ratio ? w / g.ratio : Math.max(40, g.oh + dy / z);
      setItems((prev) => (prev ?? []).map((i) => (i.id === g.id ? { ...i, w, h } : i)));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.type === "connect") {
      setWire(null);
      // Drop on another item to connect them.
      const hit = document
        .elementsFromPoint(e.clientX, e.clientY)
        .map((n) => (n as HTMLElement).closest?.("[data-item]") as HTMLElement | null)
        .find((n) => n && n.dataset.item !== g.from);
      const to = hit?.dataset.item;
      if (to && !itemsRef.current.some((i) => i.kind === "arrow" && i.from === g.from && i.to === to))
        setSelected(add({ kind: "arrow", x: 0, y: 0, w: 0, h: 0, from: g.from, to }, false).id);
      return;
    }
    if (g && (g.type === "resize" || (g.type === "move" && g.moved))) {
      dirty.current.add(g.id);
      if (g.type === "move") g.kids.forEach((k) => dirty.current.add(k.id));
      schedule();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-ui]")) return;
    const el = target.closest<HTMLElement>("[data-item]");
    if (el) {
      const it = itemsRef.current.find((i) => i.id === el.dataset.item);
      if (it?.kind === "link" && it.url) window.open(it.url, "_blank", "noopener");
      else if (it && it.kind !== "frame") setEditing(it.id);
      else if (it) addText("note", toCanvas(e.clientX, e.clientY));
      return;
    }
    addText("note", toCanvas(e.clientX, e.clientY));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const at = toCanvas(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    const url = e.dataTransfer.getData("text/uri-list").split("\n")[0] || e.dataTransfer.getData("text/plain");
    if (files.length) void uploadImages(files, at);
    else if (url && isUrl(url)) void addLink(url, at);
    else if (url) addText("note", at, url);
  };

  const grid = 24 * view.z;

  return (
    <div
      ref={box}
      className="canvas-surface relative h-full touch-none select-none overflow-hidden"
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => e.target === box.current && e.preventDefault()}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        {(items ?? []).filter((i) => i.kind === "frame").map((it) => (
          <Frame
            key={it.id}
            it={it}
            selected={selected === it.id}
            editing={editing === it.id}
            onTitle={(text) => change(it.id, { text })}
            onEdit={() => setEditing(it.id)}
            onDone={() => setEditing(null)}
          />
        ))}
        <Arrows items={items ?? []} selected={selected} wire={wire} />
        {(items ?? []).filter((i) => i.kind !== "frame" && i.kind !== "arrow").map((it) => (
          <Item
            key={it.id}
            it={it}
            looper={looper}
            selected={selected === it.id}
            editing={editing === it.id}
            onText={(text) => change(it.id, { text })}
            onDone={() => {
              setEditing(null);
              const cur = itemsRef.current.find((i) => i.id === it.id);
              if (cur && (cur.kind === "note" || cur.kind === "text") && !cur.text?.trim()) remove(it.id);
            }}
          />
        ))}
      </div>

      {items && items.length === 0 && !building && <EmptyCanvas name={looper.name} onNote={() => addText("note")} onImage={() => fileInput.current?.click()} onLink={() => setLinkBox("")} onBuild={build} />}

      {building && (
        <div data-ui className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-panel px-4 py-2 text-[0.8125rem] shadow-[var(--tile-shadow)]">
          <Bot size={18} color={looper.color} seed={looper.id} className="looping" />
          <span className="font-medium">{looper.name} is building the board</span>
          <span className="max-w-[260px] truncate text-mute">{buildProgress?.steps.at(-1)?.text ?? "Starting…"}</span>
        </div>
      )}
      {notice && !building && (
        <div data-ui className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-panel px-4 py-2 text-[0.8125rem] shadow-[var(--tile-shadow)]">
          {notice}
          <button onClick={() => setNotice(null)} className="text-mute hover:text-ink" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {linkBox !== null && (
        <form
          data-ui
          className="absolute bottom-[76px] left-1/2 z-10 flex w-[min(420px,calc(100%-32px))] -translate-x-1/2 gap-2 rounded-[18px] bg-panel p-2 shadow-[var(--tile-shadow)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (isUrl(linkBox)) void addLink(linkBox);
            setLinkBox(null);
          }}
        >
          <input
            autoFocus
            value={linkBox}
            onChange={(e) => setLinkBox(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkBox(null)}
            placeholder="Paste a link or image URL"
            className="h-9 min-w-0 flex-1 rounded-[12px] bg-ink/[0.05] px-3 text-[0.875rem] outline-none placeholder:text-faint"
          />
          <button disabled={!isUrl(linkBox)} className="h-9 rounded-full bg-blue px-4 text-[0.8125rem] font-medium text-page disabled:opacity-40">
            Add
          </button>
        </form>
      )}

      <div data-ui className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-panel p-1 shadow-[var(--tile-shadow)]">
        <Tool label="Note" onClick={() => addText("note")}>
          <path d="M4 3h9l3 3v11H4z M13 3v3h3" />
        </Tool>
        <Tool label="Text" onClick={() => addText("text")}>
          <path d="M4 5V3.5h12V5 M10 3.5V17 M7.5 17h5" />
        </Tool>
        <Tool label="Frame" onClick={() => addText("frame", undefined, "Untitled")}>
          <path d="M3 5.5h14v11H3z M3 5.5V3.5h6v2" />
        </Tool>
        <Tool label="Image" onClick={() => fileInput.current?.click()}>
          <path d="M3 4h14v12H3z M3 13l4-4 3 3 2-2 5 5" />
          <circle cx="13" cy="7.5" r="1.3" />
        </Tool>
        <Tool label="Link" onClick={() => setLinkBox((v) => (v === null ? "" : null))}>
          <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1 M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
        </Tool>
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <Tool label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          <path d="M5 10h10" />
        </Tool>
        <button onClick={() => setView((v) => ({ ...v, z: 1 }))} className="h-9 min-w-12 rounded-full px-1 text-[0.75rem] tabular-nums text-mute hover:bg-ink/[0.05] hover:text-ink" title="Reset zoom">
          {Math.round(view.z * 100)}%
        </button>
        <Tool label="Zoom in" onClick={() => zoomAt(1.25)}>
          <path d="M5 10h10 M10 5v10" />
        </Tool>
        <Tool label="Fit everything" onClick={() => fit(itemsRef.current)}>
          <path d="M3 7V3h4 M13 3h4v4 M17 13v4h-4 M7 17H3v-4" />
        </Tool>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void uploadImages([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-ink/[0.06]">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function Item(props: {
  it: CanvasItem;
  looper: { id: string; name: string; color?: Accent };
  selected: boolean;
  editing: boolean;
  onText: (text: string) => void;
  onDone: () => void;
}) {
  const { it, looper, selected, editing } = props;
  const editor = editing && (
    <textarea
      autoFocus
      defaultValue={it.text ?? ""}
      onChange={(e) => props.onText(e.target.value)}
      onBlur={props.onDone}
      onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
      placeholder={it.kind === "image" ? "Caption" : it.kind === "text" ? "Heading" : "Write a note"}
      className={cx(
        "h-full w-full resize-none bg-transparent outline-none placeholder:text-faint",
        it.kind === "text" ? "text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]" : "text-[0.9375rem] leading-relaxed",
      )}
    />
  );

  return (
    <div
      data-item={it.id}
      className={cx("group absolute", editing ? "cursor-text" : "cursor-default")}
      style={{ left: it.x, top: it.y, width: it.w, height: it.kind === "image" && it.text ? undefined : it.h }}
    >
      <div
        className={cx(
          "relative h-full w-full rounded-[14px] transition-shadow",
          selected ? "ring-2 ring-ink/50 ring-offset-2 ring-offset-page" : it.kind === "text" ? "group-hover:ring-1 group-hover:ring-ink/15" : "",
          it.kind === "note" && "canvas-note overflow-hidden p-4",
          it.kind === "text" && "p-1",
          it.kind === "link" && "canvas-note overflow-hidden",
        )}
      >
        {it.kind === "note" &&
          (editor || <div className="h-full overflow-hidden whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed">{it.text}</div>)}

        {it.kind === "text" &&
          (editor || <div className="h-full overflow-hidden whitespace-pre-wrap break-words text-[1.5rem] font-semibold leading-tight tracking-[-0.02em]">{it.text}</div>)}

        {it.kind === "image" && (
          <div className="flex h-full flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.src}
              alt={it.text ?? ""}
              draggable={false}
              className={cx("w-full rounded-[14px] bg-ink/[0.04] object-cover shadow-[var(--tile-shadow)]", it.src?.startsWith("blob:") && "opacity-60")}
              style={{ height: it.h }}
            />
            {editing ? <div className="h-16">{editor}</div> : it.text && <div className="px-1 text-[0.8125rem] leading-snug text-mute">{it.text}</div>}
          </div>
        )}

        {it.kind === "link" && (
          <div className="flex h-full">
            {it.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.image} alt="" draggable={false} className="h-full w-[38%] shrink-0 bg-ink/[0.04] object-cover" />
            )}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3.5 py-2.5">
              <div className="line-clamp-2 text-[0.875rem] font-medium leading-snug">{it.title || host(it.url)}</div>
              <div className="flex items-center gap-1 truncate text-[0.75rem] text-mute">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://www.google.com/s2/favicons?domain=${host(it.url)}&sz=32`} alt="" className="h-3 w-3 rounded-[2px]" draggable={false} />
                {host(it.url)}
              </div>
              {it.text && <div className="mt-1 line-clamp-2 text-[0.75rem] text-mute">{it.text}</div>}
            </div>
            {selected && (
              <a
                data-ui
                href={it.url}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-2 top-2 rounded-full bg-page/90 px-2 py-0.5 text-[0.6875rem] font-medium text-ink shadow-sm hover:bg-page"
              >
                Open ↗
              </a>
            )}
          </div>
        )}

        {it.by === "looper" && !editing && (
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-page/80 py-0.5 pl-0.5 pr-1.5 text-[0.625rem] text-mute">
            <Bot size={14} color={looper.color} seed={looper.id} />
            {looper.name}
          </div>
        )}
      </div>

      {selected && !editing && (
        <>
          <div data-resize className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-page bg-ink" />
          <div
            data-connect
            title="Drag to another item to connect"
            className="absolute -right-5 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full bg-ink text-[0.625rem] text-page shadow"
          >
            →
          </div>
        </>
      )}
    </div>
  );
}

/** A titled area behind items; drag it by the title and what's inside comes along. */
function Frame(props: { it: CanvasItem; selected: boolean; editing: boolean; onTitle: (t: string) => void; onEdit: () => void; onDone: () => void }) {
  const { it, selected, editing } = props;
  return (
    <div className="pointer-events-none absolute" style={{ left: it.x, top: it.y, width: it.w, height: it.h }}>
      <div className={cx("absolute inset-0 rounded-[22px] bg-ink/[0.025] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-ink)_9%,transparent)]", selected && "shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--color-ink)_45%,transparent)]")} />
      <div data-item={it.id} className="pointer-events-auto absolute -top-8 left-1 flex h-7 max-w-full cursor-grab items-center rounded-full px-2 active:cursor-grabbing">
        {editing ? (
          <input
            autoFocus
            defaultValue={it.text ?? ""}
            onChange={(e) => props.onTitle(e.target.value)}
            onBlur={props.onDone}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.target as HTMLInputElement).blur()}
            className="w-64 bg-transparent text-[0.9375rem] font-semibold outline-none"
          />
        ) : (
          <span onDoubleClick={props.onEdit} className="truncate text-[0.9375rem] font-semibold text-ink-2">
            {it.text || "Untitled"}
          </span>
        )}
      </div>
      {selected && !editing && (
        <div data-item={it.id} className="pointer-events-auto absolute -bottom-1.5 -right-1.5">
          <div data-resize className="h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-page bg-ink" />
        </div>
      )}
    </div>
  );
}

/** Arrows between items, plus the one being drawn. Click a line to select it. */
function Arrows({ items, selected, wire }: { items: CanvasItem[]; selected: string | null; wire: { from: string; x: number; y: number } | null }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = items
    .filter((i) => i.kind === "arrow")
    .map((a) => {
      const f = byId.get(a.from ?? "");
      const t = byId.get(a.to ?? "");
      if (!f || !t) return null;
      return { a, p: edgePoint(f, t), q: edgePoint(t, f) };
    })
    .filter((x) => x !== null);
  const src = wire && byId.get(wire.from);
  const pin = { id: "", kind: "note", x: wire?.x ?? 0, y: wire?.y ?? 0, w: 0, h: 0, by: "you", at: "" } as CanvasItem;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
      <defs>
        <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--color-mute)" />
        </marker>
      </defs>
      {lines.map(({ a, p, q }) => (
        <g key={a.id}>
          <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={selected === a.id ? "var(--color-ink)" : "var(--color-mute)"} strokeWidth={selected === a.id ? 2.25 : 1.5} markerEnd="url(#canvas-arrow)" />
          <line data-arrow={a.id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="transparent" strokeWidth="14" className="pointer-events-auto cursor-pointer" />
          {a.text && (
            <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} textAnchor="middle" fontSize="12" fill="var(--color-mute)">
              {a.text}
            </text>
          )}
        </g>
      ))}
      {src && (
        <line x1={edgePoint(src, pin).x} y1={edgePoint(src, pin).y} x2={wire.x} y2={wire.y} stroke="var(--color-ink)" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#canvas-arrow)" />
      )}
    </svg>
  );
}

/** Two lines and a way in: write, add a reference, or have the looper lay out a board. */
function EmptyCanvas({ name, onNote, onImage, onLink, onBuild }: { name: string; onNote: () => void; onImage: () => void; onLink: () => void; onBuild: (what: string) => void }) {
  const [what, setWhat] = useState("");
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div data-ui className="pointer-events-auto fade-up w-full max-w-md text-center">
        <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">References for {name}</div>
        <p className="mt-1 text-[0.9375rem] text-mute">Pin notes, links and screenshots. {name} reads them and can pin things too.</p>
        <div className="mt-5 flex justify-center gap-2">
          {[
            ["Note", onNote],
            ["Image", onImage],
            ["Link", onLink],
          ].map(([label, fn]) => (
            <button key={label as string} onClick={fn as () => void} className="rounded-full bg-ink/[0.06] px-4 py-2 text-[0.875rem] font-medium hover:bg-ink/[0.1]">
              {label as string}
            </button>
          ))}
        </div>
        <form
          className="mt-6 flex gap-2 rounded-full bg-panel p-1 pl-4 shadow-[var(--tile-shadow)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (what.trim()) onBuild(what.trim());
          }}
        >
          <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder={`Ask ${name} to map something…`} className="min-w-0 flex-1 bg-transparent text-[0.875rem] outline-none placeholder:text-faint" />
          <button disabled={!what.trim()} className="rounded-full bg-blue px-4 py-1.5 text-[0.8125rem] font-medium text-page disabled:opacity-40">
            Build
          </button>
        </form>
        <p className="mt-2 text-[0.75rem] text-faint">e.g. “my top 5 competitors and how they price”</p>
      </div>
    </div>
  );
}
