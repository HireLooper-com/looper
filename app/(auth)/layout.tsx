import "../app.css";
import Link from "next/link";
import { Logo } from "../logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ax">
      <div className="top">
        <Link className="logo" href="/">
          <Logo />
          Looper
        </Link>
      </div>
      <main className="narrow">{children}</main>
    </div>
  );
}
