"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { addCard, deleteCard, editCard, moveCard } from "@/app/actions";
import type { Accent, Card, Column } from "@/lib/types";
import { cardAssignee, COLUMNS } from "@/lib/types";
import { Bot, Button, Pill, Textarea, cx, timeAgo } from "./ui";

type Filter = "all" | "you" | "looper";

function Owner({ card, looperName, color, seed }: { card: Card; looperName: string; color: Accent; seed: string }) {
  return cardAssignee(card) === "you" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue px-2 py-0.5 text-[0.6875rem] font-semibold text-page">For you</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] text-mute">
      <Bot color={color} size={14} seed={seed} />
      {looperName}
    </span>
  );
}

const DOT: Record<Column, string> = { backlog: "bg-faint", todo: "bg-lavender", doing: "bg-orange", done: "bg-green" };

export function Kanban({ looperId, cards, looperName, color }: { looperId: string; cards: Card[]; looperName: string; color: Accent }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [optimistic, applyMove] = useOptimistic(cards, (state, m: { id: string; column: Column }) =>
    state.map((c) => (c.id === m.id ? { ...c, column: m.column } : c)),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Column | null>(null);
  const [open, setOpen] = useState<Card | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const forYou = optimistic.filter((c) => cardAssignee(c) === "you" && c.column !== "done").length;

  const move = (id: string, column: Column) =>
    start(async () => {
      applyMove({ id, column });
      await moveCard(id, column);
      router.refresh();
    });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-[10px] bg-ink/[0.08] p-0.5 text-[0.8125rem]">
          {([
            ["all", "All"],
            ["you", `For you${forYou ? ` · ${forYou}` : ""}`],
            ["looper", `For ${looperName}`],
          ] as [Filter, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={cx("rounded-[8px] px-3 py-1", filter === id ? "bg-panel font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-2")}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-[0.8125rem] text-mute">{looperName} works its own cards; cards marked For you need you.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = optimistic
            .filter((c) => c.column === col.id && (filter === "all" || cardAssignee(c) === filter))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={() => {
                if (dragging) move(dragging, col.id);
                setDragging(null);
                setOver(null);
              }}
              className={cx("flex min-h-72 flex-col rounded-[20px] bg-ink/[0.07] p-2 transition-colors", over === col.id && "bg-ink/[0.11]")}
            >
              <div className="flex items-center justify-between px-2 py-2">
                <div className="flex items-center gap-2 text-[0.8125rem] font-medium">
                  <span className={cx("h-2 w-2 rounded-full", DOT[col.id])} />
                  {col.label}
                  <span className="text-faint">{list.length}</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {list.map((c) => (
                  <button
                    key={c.id}
                    draggable
                    onDragStart={() => setDragging(c.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setOpen(c)}
                    className={cx(
                      "cursor-grab rounded-[12px] bg-panel p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-opacity active:cursor-grabbing",
                      cardAssignee(c) === "you" && c.column !== "done" && "ring-2 ring-blue/50",
                      dragging === c.id && "opacity-40",
                    )}
                  >
                    <div className="text-[0.875rem] leading-snug">{c.title}</div>
                    {c.description && <div className="mt-1 line-clamp-2 text-[0.75rem] text-mute">{c.description}</div>}
                    <div className="mt-2.5 flex items-center justify-between gap-2 text-[0.6875rem] text-faint">
                      <Owner card={c} looperName={looperName} color={color} seed={looperId} />
                      <span>{timeAgo(c.updatedAt)}</span>
                    </div>
                  </button>
                ))}
                <AddCard looperId={looperId} column={col.id} assignee={filter === "you" ? "you" : "looper"} />
              </div>
            </div>
          );
        })}
      </div>
      {open && <CardSheet card={open} looperName={looperName} onClose={() => setOpen(null)} onMove={(col) => { move(open.id, col); setOpen(null); }} />}
    </>
  );
}

function AddCard({ looperId, column, assignee }: { looperId: string; column: Column; assignee: "looper" | "you" }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  if (!editing)
    return (
      <button onClick={() => setEditing(true)} className="rounded-[12px] px-2 py-2 text-left text-[0.8125rem] text-faint hover:bg-white/70 hover:text-blue">
        + Add card
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return setEditing(false);
        start(async () => {
          await addCard(looperId, text, column, assignee);
          setText("");
          setEditing(false);
          router.refresh();
        });
      }}
    >
      <input
        autoFocus
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text && setEditing(false)}
        placeholder="Card title, Enter to add"
        className="w-full rounded-[12px] border border-blue bg-panel px-3 py-2.5 ring-4 ring-blue/15 text-[0.875rem] outline-none"
      />
    </form>
  );
}

function CardSheet({ card, looperName, onClose, onMove }: { card: Card; looperName: string; onClose: () => void; onMove: (c: Column) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description);
  const [assignee, setAssignee] = useState(cardAssignee(card));
  const [pending, start] = useTransition();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg tile p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <Pill>{card.createdBy === "looper" ? "Created by looper" : card.createdBy === "chief" ? "From Chief" : "Created by you"}</Pill>
          <button onClick={onClose} className="text-mute hover:text-ink" aria-label="Close">✕</button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-4 w-full bg-transparent text-[1.375rem] font-medium tracking-[-0.02em] outline-none" />
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={6} placeholder="Notes" className="mt-3" />
        <div className="mt-4 flex items-center gap-3 text-[0.8125rem]">
          <span className="text-mute">For</span>
          <div className="inline-flex rounded-[10px] bg-ink/[0.08] p-0.5">
            {([
              ["you", "You"],
              ["looper", looperName],
            ] as ["looper" | "you", string][]).map(([id, label]) => (
              <button key={id} onClick={() => setAssignee(id)} className={cx("rounded-[8px] px-3 py-1", assignee === id ? "bg-panel font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-2")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => (
            <button
              key={c.id}
              onClick={() => onMove(c.id)}
              className={cx("rounded-full px-3 py-1.5 text-[0.8125rem]", card.column === c.id ? "bg-blue text-page" : "bg-ink/[0.07] hover:bg-ink/[0.11]")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-between gap-2">
          <Button variant="danger" size="sm" disabled={pending} onClick={() => start(async () => { await deleteCard(card.id); onClose(); router.refresh(); })}>
            Delete
          </Button>
          <Button size="sm" disabled={pending} onClick={() => start(async () => { await editCard(card.id, { title, description: desc, assignee }); onClose(); router.refresh(); })}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
