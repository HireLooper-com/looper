import Link from "next/link";
import { redirect } from "next/navigation";
import { signup } from "../../actions";
import { CodeForm, TzField } from "../../ui";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Start a free trial: Looper" };

export default async function Signup() {
  if (await currentUser()) redirect("/app");
  return (
    <>
      <h1>
        Pro, 7 days free. <span className="c">Then $100/mo. Unlimited loopers, on your own model key.</span>
      </h1>
      <p className="lede">Create the account, start the plan, then hire your looper. Setup takes about 10 minutes.</p>
      <CodeForm action={signup} label="Create account" busy="Creating">
        <TzField />
      </CodeForm>
      <p className="note" style={{ marginTop: 24 }}>
        Have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
