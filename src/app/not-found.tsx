import { NotFoundView } from "@/components/not-found-view";

// Any unknown URL, or a page that called notFound(), lands here inside the app frame.
export default function NotFound() {
  return <NotFoundView title="Nothing here" body="This page doesn't exist or was moved. The link may be old or mistyped." />;
}
