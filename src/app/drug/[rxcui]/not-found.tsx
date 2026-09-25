import { StatusPage } from "@/ui/StatusPage";

/**
 * RxNorm answered, and has no drug with this RxCUI: `Query.drug` returned null
 * and the header boundary called `notFound()`. The response streamed, so the
 * status is 200 and Next adds `noindex` (not-found docs, Status Codes).
 *
 * A not-found page takes no props, so it cannot name the RxCUI. Draft copy.
 * RxNorm does retire concepts, which is why an old link can land here.
 */
export default function DrugNotFound() {
  return (
    <StatusPage title="RxNorm doesn’t know this drug">
      <p>
        There is no drug with this ID. The link may be mistyped, or RxNorm may
        have retired the ID since it was shared.
      </p>
    </StatusPage>
  );
}
