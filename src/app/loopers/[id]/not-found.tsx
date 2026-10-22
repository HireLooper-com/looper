import { NotFoundView } from "@/components/not-found-view";

// The usual cause: the looper was let go, or it works in another workspace than the one open.
export default function LooperNotFound() {
  return (
    <NotFoundView
      title="This looper isn't here"
      body="It may have been let go, or it works in another workspace. Switch workspaces from the menu at the bottom left."
    />
  );
}
