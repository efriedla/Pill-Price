import { StatusPage } from "@/ui/StatusPage";

/**
 * Any URL this app has no route for. Copy is my draft (2026-09-25), yours to
 * replace, like the label's and search's.
 */
export default function NotFound() {
  return (
    <StatusPage title="There’s no page here">
      <p>The link may be mistyped, or the page may have moved.</p>
    </StatusPage>
  );
}
