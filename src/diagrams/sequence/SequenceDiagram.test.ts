import { parse, render, toPlaintext } from "../../api.ts";
import { clearRegistry, registerDiagram } from "../../registry.ts";
import { assertOk } from "../../testUtils.ts";
import { SequenceDiagram } from "./SequenceDiagram.ts";
import type { SequenceDiagramAST } from "./sequenceTypes.ts";

const sequenceDiagram = new SequenceDiagram();

beforeAll(() => {
	clearRegistry();
	registerDiagram(sequenceDiagram);
});

const BASIC_SEQUENCE = `sequenceDiagram
  participant Alice
  participant Bob
  Alice ->> Bob: Hello
  Bob -->> Alice: Hi there`;

describe("sequenceDiagram detect()", () => {
	test('detects "sequenceDiagram"', () => {
		expect(sequenceDiagram.detect("sequenceDiagram")).toBe(true);
	});
	test("is case-insensitive", () => {
		expect(sequenceDiagram.detect("SEQUENCEDIAGRAM")).toBe(true);
	});
	test("detects short-form `sequence` alias", () => {
		expect(sequenceDiagram.detect("sequence")).toBe(true);
		expect(sequenceDiagram.detect("SEQUENCE")).toBe(true);
	});
	test("does not detect other diagram types", () => {
		expect(sequenceDiagram.detect("stateDiagram-v2")).toBe(false);
		expect(sequenceDiagram.detect("wireframe")).toBe(false);
	});
});

describe("sequenceDiagram parse()", () => {
	test("parses participants", () => {
		const ast = assertOk<SequenceDiagramAST>(parse(BASIC_SEQUENCE));
		expect(ast.participants.map((p) => p.actor)).toContain("Alice");
	});

	test("parses messages", () => {
		const ast = assertOk<SequenceDiagramAST>(parse(BASIC_SEQUENCE));
		const messages = ast.statements.filter((s) => s.kind === "message");
		expect(messages).toHaveLength(2);
	});

	test("parses loop groups", () => {
		const src = `sequenceDiagram
  Alice ->> Bob: Start
  loop Retry
    Alice ->> Bob: Retry
  end`;
		const ast = assertOk<SequenceDiagramAST>(parse(src));
		const loops = ast.statements.filter((s) => s.kind === "loop");
		expect(loops).toHaveLength(1);
	});

	test("parses alt/else branches", () => {
		const src = `sequenceDiagram
  alt success
    Alice ->> Bob: Ok
  else failure
    Alice ->> Bob: Error
  end`;
		const ast = assertOk<SequenceDiagramAST>(parse(src));
		const alts = ast.statements.filter((s) => s.kind === "alt");
		expect(alts).toHaveLength(1);
		expect(alts[0]?.branches).toHaveLength(2);
	});

	test("auto-registers implicit participants from messages", () => {
		const src = `sequenceDiagram\n  X ->> Y: Go`;
		const ast = assertOk<SequenceDiagramAST>(parse(src));
		const actors = ast.participants.map((p) => p.actor);
		expect(actors).toContain("X");
		expect(actors).toContain("Y");
	});

	test("returns ok:false for empty source", () => {
		const result = parse("");
		expect(result.ok).toBe(false);
	});
});

describe("sequenceDiagram render()", () => {
	test("produces valid SVG output", () => {
		const ast = assertOk<SequenceDiagramAST>(parse(BASIC_SEQUENCE));
		const svg = render(ast);
		expect(svg).toMatch(/^<svg/);
		expect(svg).toContain("</svg>");
	});

	test("SVG contains actor labels", () => {
		const ast = assertOk<SequenceDiagramAST>(parse(BASIC_SEQUENCE));
		const svg = render(ast);
		expect(svg).toContain("Alice");
		expect(svg).toContain("Bob");
	});

	test("SVG renders advanced statement types", () => {
		const src = `sequenceDiagram
  note over Alice: test note
  loop L
    Alice->>Bob: test
  end`;
		const ast = assertOk<SequenceDiagramAST>(parse(src));
		const svg = render(ast);
		expect(svg).toContain("test note");
		expect(svg).toContain("LOOP");
	});
});

describe("sequenceDiagram toPlaintext()", () => {
	test("round-trip produces structurally equivalent AST for basic", () => {
		const ast1 = assertOk<SequenceDiagramAST>(parse(BASIC_SEQUENCE));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<SequenceDiagramAST>(parse(text));
		expect(ast2.participants).toHaveLength(ast1.participants.length);
		expect(ast2.statements).toHaveLength(ast1.statements.length);
	});

	test("round-trip produces structurally equivalent AST for advanced blocks", () => {
		const src = `sequenceDiagram
  title Advanced Spec
  accTitle: Accessibility Title
  accDescr: Accessibility Description
  autonumber
  participant Alice as A
  note left of Alice: Note 1
  note over Alice,Bob: Note 2
  loop X
    Alice ->> Bob: msg
    break y
      Bob -->> Alice: done
    end
  end
  alt a
    Alice ->> Bob: a
  else b
    Alice ->> Bob: b
  end
  par c
    Alice ->> Bob: c
  and d
    Alice ->> Bob: d
  end
  rect rgb(0,0,0)
    Alice ->> Bob: e
  end`;
		const ast1 = assertOk<SequenceDiagramAST>(parse(src));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<SequenceDiagramAST>(parse(text));
		expect(ast2.statements).toHaveLength(ast1.statements.length);
		expect(ast2.title).toBe(ast1.title);
	});
});

describe("testUtils coverage", () => {
	test("assertOk throws on failure", () => {
		const res = parse("sequenceDiagram\n  participant");
		expect(() => assertOk(res)).toThrow();
	});
});
