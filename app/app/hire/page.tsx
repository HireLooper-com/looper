import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { currentWorkspace, wsPaid } from "@/lib/workspace";
import HireChart from "./chart";

export default async function Hire() {
  const u = await requireUser();
  const ws = await currentWorkspace(u);
  if (!wsPaid(ws) || !ws.website) redirect("/app");
  return (
    <main className="wide">
      <h1>
        Your team. <span className="c">One looper per business metric, each working on its own to move it.</span>
      </h1>
      <HireChart ws={ws} />
    </main>
  );
}
