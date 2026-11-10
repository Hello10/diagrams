import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, toPlaintext } from "./api.ts";
import { findProblems } from "./diagnostics.ts";
import { getDiagram } from "./registry.ts";
import { assertOk } from "./testUtils.ts";

/**
 * Every fixture of every diagram type that exposes diagnostics draws with
 * no line through a box it does not connect, no label on a box, another
 * label, or someone else's line, no two arrowheads at one point, and no
 * two boxes overlapping. The examples are the showcase; the fixtures
 * under each diagram's `fixtures/` are the awkward inputs that exist to
 * be checked, not looked at.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cases: { name: string; path: string }[] = [
	{ name: "class.txt", path: resolve(here, "../examples/diagrams/class.txt") },
];
const classFixtures = resolve(here, "diagrams/class/fixtures");
for (const file of readdirSync(classFixtures).sort()) {
	if (file.endsWith(".txt"))
		cases.push({ name: `class/${file}`, path: resolve(classFixtures, file) });
}

describe("drawings are clean", () => {
	for (const { name, path } of cases) {
		test(name, () => {
			const ast = assertOk(parse(readFileSync(path, "utf8")));
			const diagram = getDiagram(ast.type);
			if (!diagram?.diagnostics)
				throw new Error(`${ast.type} has no diagnostics`);
			expect(findProblems(diagram.diagnostics(ast))).toEqual([]);
			// And the fixture round-trips, like the examples do.
			expect(assertOk(parse(toPlaintext(ast)))).toEqual(ast);
		});
	}
});
