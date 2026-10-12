import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "../../actions";
import { CodeForm } from "../../ui";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Sign in: Looper" };

export default async function Login() {
  if (await currentUser()) redirect("/app");
  return (
    <>
      <h1>Sign in</h1>
      <p className="lede">We email you a 6-digit code. No password.</p>
      <CodeForm action={login} label="Sign in" busy="Signing in" />
      <p className="note" style={{ marginTop: 24 }}>
        New here? <Link href="/signup">Start a free trial</Link>
      </p>
    </>
  );
}
