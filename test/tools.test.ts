import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTools, type Tool } from "../lib/composio.ts";

const t = (slug: string): Tool => ({ slug, name: slug, description: "", input_parameters: {} });
const slugs = (xs: Tool[]) => xs.map((x) => x.slug);

test("important tools come first, the rest fills in without duplicates", () => {
  const important = [t("GSC_GET_SITE"), t("GSC_ADD_SITE")];
  const rest = [t("GSC_ADD_SITE"), t("GSC_SEARCH_ANALYTICS_QUERY"), t("GSC_GET_SITE"), t("GSC_LIST_SITES")];
  assert.deepEqual(slugs(mergeTools(important, rest, 25)), ["GSC_GET_SITE", "GSC_ADD_SITE", "GSC_SEARCH_ANALYTICS_QUERY", "GSC_LIST_SITES"]);
});

test("the limit keeps important tools over the rest", () => {
  assert.deepEqual(slugs(mergeTools([t("A"), t("B")], [t("C"), t("D")], 3)), ["A", "B", "C"]);
  assert.deepEqual(slugs(mergeTools([], [t("C")], 3)), ["C"]);
});
