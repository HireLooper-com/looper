import { redirect } from "next/navigation";

// Chief is the front door: hire, brief and check on loopers from one chat.
export default function Home() {
  redirect("/chief");
}
