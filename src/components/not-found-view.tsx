"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Button } from "./ui";

/** What a missing page shows instead of the bare framework 404: what happened and a way back. */
export function NotFoundView({ title, body }: { title: string; body: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-[480px] flex-col items-center justify-center px-6 py-16 text-center">
      <Bot dark size={64} />
      <h1 className="display mt-6 text-[2rem]">{title}</h1>
      <p className="mt-2 text-[1rem] text-mute">{body}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Link href="/chief" className="inline-flex h-10 items-center rounded-full bg-blue px-5 text-[0.9375rem] font-medium text-page hover:bg-blue-hover">
          Go to Chief
        </Link>
        <Button variant="soft" onClick={() => (history.length > 1 ? router.back() : router.push("/chief"))}>
          Go back
        </Button>
      </div>
      <p className="mt-6 text-[0.8125rem] text-mute">Or press ⌘K to jump anywhere.</p>
    </div>
  );
}
