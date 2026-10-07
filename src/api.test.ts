import { fromJSON, parse, render, toJSON, toPlaintext } from "./api.ts";
import { SequenceDiagram } from "./diagrams/sequence/index.ts";
import { StateDiagram } from "./diagrams/state/index.ts";
import { clearRegistry, registerDiagram } from "./registry.ts";

// Re-register built-ins after each clearRegistry in other tests
beforeAll(() => {
	clearRegistry();
	registerDiagram(new SequenceDiagram());
	registerDiagram(new StateDiagram());
});

describe("parse()", () => {
	test("returns error result for empty source", () => {
		const result = parse("");
		expect(result.ok).toBe(false);
	});

	test("returns error result for unknown diagram type", () => {
		const result = parse("unknownDiagram\n  A --> B");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0]?.message).toMatch(/unknown diagram type/i);
		}
	});

	test("parses a sequenceDiagram successfully", () => {
		const src = `sequenceDiagram\n  Alice ->> Bob: Hello`;
		const result = parse(src);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.ast.type).toBe("sequenceDiagram");
		}
	});

	test("parses a stateDiagram-v2 successfully", () => {
		const src = `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running`;
		const result = parse(src);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.ast.type).toBe("stateDiagram");
		}
	});

	test("skips leading comments before detecting diagram type", () => {
		const src = `%% my diagram\nsequenceDiagram\n  A ->> B: hi`;
		const result = parse(src);
		expect(result.ok).toBe(true);
	});
});

describe("render()", () => {
	test("renders a sequenceDiagram to SVG", () => {
		const result = parse(`sequenceDiagram\n  Alice ->> Bob: Hello`);
		if (!result.ok) throw new Error("parse failed");
		const svg = render(result.ast);
		expect(svg).toContain("<svg");
		expect(svg).toContain("</svg>");
	});

	test("throws for an unregistered diagram type", () => {
		expect(() => render({ type: "notRegistered" })).toThrow(/notRegistered/);
	});
});

describe("toJSON / fromJSON round-trip", () => {
	test("serialises and deserialises a sequenceDiagram AST", () => {
		const result = parse(
			`sequenceDiagram\n  Alice ->> Bob: Hello\n  Bob -->> Alice: World`,
		);
		if (!result.ok) throw new Error("parse failed");

		const json = toJSON(result.ast);
		expect(typeof json).toBe("string");

		const restored = fromJSON(json);
		expect(restored.type).toBe("sequenceDiagram");
	});
});

describe("toPlaintext()", () => {
	test("converts a sequenceDiagram AST back to plaintext", () => {
		const src = `sequenceDiagram\n  Alice ->> Bob: Hello`;
		const result = parse(src);
		if (!result.ok) throw new Error("parse failed");

		const text = toPlaintext(result.ast);
		expect(text).toContain("sequenceDiagram");
		expect(text).toContain("Alice");
		expect(text).toContain("Bob");
	});

	test("throws for an unregistered diagram type", () => {
		expect(() => toPlaintext({ type: "notRegistered" })).toThrow(
			/notRegistered/,
		);
	});
});
