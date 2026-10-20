"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { joinWorkspace, switchWorkspace } from "@/app/workspace-actions";
import { Button } from "@/components/ui";

export function JoinButton({ token, already, wsId }: { token: string; already: boolean; wsId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              if (already) await switchWorkspace(wsId);
              else await joinWorkspace(token);
              router.push("/");
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
        className="w-full"
      >
        {pending ? "Joining…" : already ? "Open workspace" : "Join workspace"}
      </Button>
      {error && <p className="text-[0.8125rem] text-red">{error}</p>}
    </div>
  );
}
