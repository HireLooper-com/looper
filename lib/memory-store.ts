// Memory every looper keeps, scoped to one workspace (tables in lib/db.ts).
//
// Notes: what the business taught its loopers ("we don't target enterprise"). A note exists only
// after a workspace member approved it; an edit is a new row that supersedes the old one, so
// nothing changes without a trace. Notes expire after 90 days unless kept.
//
// Ledger: what a looper tracks (a page, a query, a keyword) with its status and the card that
// acted on it. Code writes it from tool reads, with the time of the read; the model only reads it.
//
// Every function takes the workspace id first and every query filters by it. Callers pass a
// workspace they resolved through membership (workspaceFor) or from the looper itself (the tick).
// This is the only file that queries `notes` or `ledger`; test/memory.test.ts checks that.
// It takes the query tag as an argument so tests can run it without the Next.js resolver.

export type Tag = <T = Record<string, any>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

export type Note = {
  id: number;
  workspace_id: number;
  looper_id: number | null;
  text: string;
  source_kind: string;
  source_id: number | null;
  approved_by: number | null;
  supersedes: number | null;
  expires_on: string | null;
  status: "live" | "superseded" | "expired" | "deleted";
  created_at: Date;
};

export type LedgerRow = {
  id: number;
  workspace_id: number;
  looper_id: number;
  kind: string;
  key: string;
  status: LedgerStatus;
  card_id: number | null;
  data: Record<string, unknown>;
  read_at: Date | null;
  updated_at: Date;
};

export const NOTE_SOURCES = ["talk", "reflection", "card_reject", "settings"] as const;
export const LEDGER_STATUSES = ["open", "carded", "done", "won", "lost", "dropped"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const NOTE_DAYS = 90;
export const NOTE_MAX = 500;
const KIND = /^[a-z_]{1,32}$/;

/** A note's text: one line, trimmed, at most 500 characters. Throws when empty. */
export function cleanNote(text: string) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  if (!t) throw new Error("A note needs text");
  return t;
}

/** The default expiry: 90 days after `from`, as YYYY-MM-DD. */
export function expiryFrom(from: Date, days = NOTE_DAYS) {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function memoryStore(sql: Tag) {
  const notes = {
    /** Live notes for one looper: its own plus the workspace-wide ones, newest first. */
    live(wsId: number, looperId: number, limit = 30) {
      return sql<Note>`
        select * from notes
        where workspace_id = ${wsId} and status = 'live'
          and (looper_id is null or looper_id = ${looperId})
          and (expires_on is null or expires_on >= current_date)
        order by created_at desc, id desc limit ${limit}`;
    },

    /** Every note in the workspace with any status, for the Memory tab. */
    all(wsId: number, limit = 200) {
      return sql<Note>`select * from notes where workspace_id = ${wsId} order by created_at desc, id desc limit ${limit}`;
    },

    /**
     * Save a note a person approved. The approver must be a member of the workspace, the looper
     * must be in it (the database checks), and a superseded note must be a live note of the same workspace.
     */
    async add(
      wsId: number,
      n: { looperId: number | null; text: string; sourceKind: (typeof NOTE_SOURCES)[number]; sourceId?: number | null; approvedBy: number; supersedes?: number | null; expiresOn?: string | null },
    ) {
      if (!NOTE_SOURCES.includes(n.sourceKind)) throw new Error(`Unknown note source: ${n.sourceKind}`);
      const text = cleanNote(n.text);
      if (n.supersedes) {
        const [old] = await sql<{ id: number }>`
          select id from notes where id = ${n.supersedes} and workspace_id = ${wsId} and status = 'live'`;
        if (!old) throw new Error("The note to replace is not in this workspace");
      }
      const expires = n.expiresOn === undefined ? expiryFrom(new Date()) : n.expiresOn;
      const [row] = await sql<Note>`
        insert into notes (workspace_id, looper_id, text, source_kind, source_id, approved_by, supersedes, expires_on)
        select ${wsId}, ${n.looperId}, ${text}, ${n.sourceKind}, ${n.sourceId ?? null}, ${n.approvedBy}, ${n.supersedes ?? null}, ${expires}
        where exists (select 1 from members where workspace_id = ${wsId} and user_id = ${n.approvedBy})
        returning *`;
      if (!row) throw new Error("Only a member of the workspace can approve a note");
      if (n.supersedes) await sql`update notes set status = 'superseded' where id = ${n.supersedes} and workspace_id = ${wsId}`;
      return row;
    },

    /** Mark a note deleted. The row stays so cards that used it can still show it. */
    async remove(wsId: number, id: number) {
      const rows = await sql`update notes set status = 'deleted' where id = ${id} and workspace_id = ${wsId} and status = 'live' returning id`;
      return rows.length > 0;
    },

    /** Keep a note another 90 days from today. */
    async keep(wsId: number, id: number) {
      const rows = await sql`
        update notes set expires_on = ${expiryFrom(new Date())}
        where id = ${id} and workspace_id = ${wsId} and status = 'live' returning id`;
      return rows.length > 0;
    },

    /** From the tick: live notes past their date become expired, in every workspace. Reads nothing back. */
    async expireDue() {
      const rows = await sql`
        update notes set status = 'expired' where status = 'live' and expires_on < current_date returning id`;
      return rows.length;
    },
  };

  const ledger = {
    /** Record what a tool read returned for one item. Status and card stay as they were. */
    async upsert(wsId: number, looperId: number, kind: string, key: string, data: Record<string, unknown>, readAt = new Date()) {
      if (!KIND.test(kind)) throw new Error(`Bad ledger kind: ${kind}`);
      const k = String(key).trim().slice(0, 2000);
      if (!k) throw new Error("A ledger row needs a key");
      const [row] = await sql<LedgerRow>`
        insert into ledger (workspace_id, looper_id, kind, key, data, read_at)
        values (${wsId}, ${looperId}, ${kind}, ${k}, ${JSON.stringify(data)}::jsonb, ${readAt.toISOString()})
        on conflict (looper_id, kind, key) do update
          set data = excluded.data, read_at = excluded.read_at, updated_at = now()
          where ledger.workspace_id = excluded.workspace_id
        returning *`;
      if (!row) throw new Error("That looper is not in this workspace");
      return row;
    },

    /** Move an item along: open, carded, done, won, lost, dropped. Optionally link the card. */
    async setStatus(wsId: number, looperId: number, kind: string, key: string, status: LedgerStatus, cardId?: number | null) {
      if (!LEDGER_STATUSES.includes(status)) throw new Error(`Bad ledger status: ${status}`);
      if (cardId) {
        const [card] = await sql`select id from cards where id = ${cardId} and looper_id = ${looperId}`;
        if (!card) throw new Error("The card is not this looper's");
      }
      const rows = await sql<LedgerRow>`
        update ledger set status = ${status}, card_id = coalesce(${cardId ?? null}::int, card_id), updated_at = now()
        where workspace_id = ${wsId} and looper_id = ${looperId} and kind = ${kind} and key = ${key}
        returning *`;
      return rows[0] ?? null;
    },

    async get(wsId: number, looperId: number, kind: string, key: string) {
      const [row] = await sql<LedgerRow>`
        select * from ledger where workspace_id = ${wsId} and looper_id = ${looperId} and kind = ${kind} and key = ${key}`;
      return row ?? null;
    },

    /** Items of one kind for a routine to pick from: open first, then the rest, most recently read first. */
    list(wsId: number, looperId: number, kind: string, limit = 60) {
      return sql<LedgerRow>`
        select * from ledger
        where workspace_id = ${wsId} and looper_id = ${looperId} and kind = ${kind}
        order by (status = 'open') desc, read_at desc nulls last, id desc limit ${limit}`;
    },

    /** Items of one kind whose key contains `query` (any when empty), most recently changed first. */
    find(wsId: number, looperId: number, kind: string, query = "", limit = 20) {
      const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return sql<LedgerRow>`
        select * from ledger
        where workspace_id = ${wsId} and looper_id = ${looperId} and kind = ${kind} and key ilike ${like}
        order by updated_at desc, id desc limit ${limit}`;
    },
  };

  return { notes, ledger };
}
