import { writeFile } from "node:fs/promises";

import {
  buildExecutiveSalesPulseReport,
  renderExecutiveSalesPulseHtml,
} from "../app/lib/executive-sales-pulse-preview.ts";
import {
  executiveSalesPulseFixture,
  fixtureGeneratedAt,
} from "../prototype/executive-sales-pulse-fixtures.ts";

const outputUrl = new URL(
  "../public/executive-sales-pulse-preview.html",
  import.meta.url,
);
const report = buildExecutiveSalesPulseReport({
  fixture: executiveSalesPulseFixture,
  generatedAt: fixtureGeneratedAt,
});

await writeFile(outputUrl, renderExecutiveSalesPulseHtml(report), "utf8");
console.log(outputUrl.pathname);
