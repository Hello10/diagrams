import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, render } from "./api.ts";
import { assertOk } from "./testUtils.ts";

/**
 * Golden SVG for every fixture. Edge routing and label placement are being
 * moved into a shared router; these snapshots are what "do not break the
 * existing diagrams" means. A change here must be looked at and approved
 * (`vp test -u`), never waved through.
 */
const fixturesDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../examples/diagrams",
);

for (const name of ["state", "flowchart", "class", "sequence", "ui"]) {
	test(`${name}.txt renders the approved SVG`, async () => {
		const src = readFileSync(resolve(fixturesDir, `${name}.txt`), "utf8");
		const svg = render(assertOk(parse(src)));
		await expect(svg).toMatchFileSnapshot(`__snapshots__/${name}.svg`);
	});
}
