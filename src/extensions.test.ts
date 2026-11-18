import { diagramExtensions, isDiagramPath } from "./extensions.ts";

describe("diagramExtensions", () => {
	test("lists the canonical extension first", () => {
		expect(diagramExtensions).toEqual([".dgrm", ".dgrm.txt"]);
	});
});

describe("isDiagramPath", () => {
	test.each([
		"flow.dgrm",
		"flow.dgrm.txt",
		"examples/diagrams/ui/shell.dgrm",
		"C:\\diagrams\\flow.dgrm.txt",
		"Flow.DGRM",
	])("accepts %s", (path) => {
		expect(isDiagramPath(path)).toBe(true);
	});

	test.each([
		"flow.txt",
		"flow.dgrm.md",
		"flow.dgrmx",
		"flowdgrm",
		".dgrm",
		"diagrams/.dgrm.txt",
		"flow.dgrm/notes.txt",
	])("rejects %s", (path) => {
		expect(isDiagramPath(path)).toBe(false);
	});
});
