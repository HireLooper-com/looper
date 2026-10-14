"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { addCard, deleteCard, editCard, moveCard } from "@/app/actions";
import type { Card, Column } from "@/lib/types";
import { COLUMNS } from "@/lib/types";
import { Button, Pill, Textarea, cx, timeAgo } from "./ui";

const DOT: Record<Column, string> = { backlog: "bg-faint", todo: "bg-lavender", doing: "bg-orange", done: "bg-green" };

export function Kanban({ looperId, cards }: { looperId: string; cards: Card[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [optimistic, applyMove] = useOptimistic(cards, (state, m: { id: string; column: Column }) =>
    state.map((c) => (c.id === m.id ? { ...c, column: m.column } : c)),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Column | null>(null);
  const [open, setOpen] = useState<Card | null>(null);

  const move = (id: string, column: Column) =>
    start(async () => {
      applyMove({ id, column });
      await moveCard(id, column);
      router.refresh();
    });

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = optimistic.filter((c) => c.column === col.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
              className={cx("flex min-h-72 flex-col rounded-[20px] bg-[#ebebf0] p-2 transition-colors", over === col.id && "bg-[#dfdfe6]")}
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
                      "cursor-grab rounded-[12px] bg-white p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-opacity active:cursor-grabbing",
                      dragging === c.id && "opacity-40",
                    )}
                  >
                    <div className="text-[0.875rem] leading-snug">{c.title}</div>
                    {c.description && <div className="mt-1 line-clamp-2 text-[0.75rem] text-mute">{c.description}</div>}
                    <div className="mt-2.5 flex items-center justify-between text-[0.6875rem] text-faint">
                      <span>{c.createdBy === "looper" ? "by looper" : c.createdBy === "chief" ? "from Chief" : "by you"}</span>
                      <span>{timeAgo(c.updatedAt)}</span>
                    </div>
                  </button>
                ))}
                <AddCard looperId={looperId} column={col.id} />
              </div>
            </div>
          );
        })}
      </div>
      {open && <CardSheet card={open} onClose={() => setOpen(null)} onMove={(col) => { move(open.id, col); setOpen(null); }} />}
    </>
  );
}

function AddCard({ looperId, column }: { looperId: string; column: Column }) {
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
          await addCard(looperId, text, column);
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
        className="w-full rounded-[12px] border border-blue bg-white px-3 py-2.5 ring-4 ring-blue/15 text-[0.875rem] outline-none"
      />
    </form>
  );
}

function CardSheet({ card, onClose, onMove }: { card: Card; onClose: () => void; onMove: (c: Column) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description);
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
        <div className="mt-4 flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => (
            <button
              key={c.id}
              onClick={() => onMove(c.id)}
              className={cx("rounded-full px-3 py-1.5 text-[0.8125rem]", card.column === c.id ? "bg-blue text-white" : "bg-[#ebebf0] hover:bg-[#dfdfe6]")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-between gap-2">
          <Button variant="danger" size="sm" disabled={pending} onClick={() => start(async () => { await deleteCard(card.id); onClose(); router.refresh(); })}>
            Delete
          </Button>
          <Button size="sm" disabled={pending} onClick={() => start(async () => { await editCard(card.id, { title, description: desc }); onClose(); router.refresh(); })}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
