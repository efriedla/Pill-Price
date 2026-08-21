/** Internal to the `search` slice. Re-exported from `index.ts` where public. */
export interface SearchQuery {
  q: string;
  form: string | null;
  sort: "price" | "name" | "updated";
}
