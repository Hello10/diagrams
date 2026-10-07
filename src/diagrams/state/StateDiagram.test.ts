import { parse, render, toPlaintext } from "../../api.ts";
import { clearRegistry, registerDiagram } from "../../registry.ts";
import { assertOk } from "../../testUtils.ts";
import { StateDiagram } from "./StateDiagram.ts";
import type { StateDiagramAST } from "./stateTypes.ts";

const stateDiagram = new StateDiagram();

beforeAll(() => {
	clearRegistry();
	registerDiagram(stateDiagram);
});

const BASIC_STATE = `stateDiagram-v2
  [*] --> Disconnected
  Disconnected --> Connected`;

describe("stateDiagram detect()", () => {
	test("detects stateDiagram-v2", () => {
		expect(stateDiagram.detect("stateDiagram-v2")).toBe(true);
	});

	test("detects stateDiagram (v1 compat)", () => {
		expect(stateDiagram.detect("stateDiagram")).toBe(true);
	});

	test("detection is case-insensitive", () => {
		expect(stateDiagram.detect("STATEDIAGRAM-V2")).toBe(true);
	});

	test("detects short-form `state` alias", () => {
		expect(stateDiagram.detect("state")).toBe(true);
		expect(stateDiagram.detect("STATE")).toBe(true);
	});

	test("does not detect other types", () => {
		expect(stateDiagram.detect("sequenceDiagram")).toBe(false);
		expect(stateDiagram.detect("wireframe")).toBe(false);
	});
});

describe("stateDiagram parse()", () => {
	test("returns ok:false for empty source", () => {
		const result = parse("");
		expect(result.ok).toBe(false);
	});

	test("parses states and transitions successfully via global API", () => {
		const ast = assertOk<StateDiagramAST>(parse(BASIC_STATE));
		expect(ast.type).toBe("stateDiagram");
		expect(ast.transitions).toHaveLength(2);
	});
});

describe("stateDiagram render()", () => {
	test("produces valid SVG output", () => {
		const ast = assertOk<StateDiagramAST>(parse(BASIC_STATE));
		const svg = render(ast);
		expect(svg).toMatch(/^<svg/);
		expect(svg).toContain("</svg>");
	});

	test("SVG contains state labels and titles", () => {
		const ast = assertOk<StateDiagramAST>(
			parse(
				`stateDiagram-v2\n  title My Diagram\n  [*] --> Connected: MyLabel`,
			),
		);
		const svg = render(ast);
		expect(svg).toContain("My Diagram");
		expect(svg).toContain("MyLabel");
		expect(svg).toContain("Connected");
	});
});

describe("stateDiagram toPlaintext()", () => {
	test("round-trip produces structurally equivalent AST with notes and titles", () => {
		const src = `stateDiagram-v2
  title Diagram Title
  note left of Idle: This is a note
  state "Active" as A
  A --> [*]: transition_label`;
		const ast1 = assertOk<StateDiagramAST>(parse(src));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<StateDiagramAST>(parse(text));
		expect(ast2.title).toBe("Diagram Title");
		expect(ast2.notes).toHaveLength(1);
		expect(ast2.transitions).toHaveLength(1);
	});
	test("round-trip produces structurally equivalent AST for basic state", () => {
		const ast1 = assertOk<StateDiagramAST>(parse(BASIC_STATE));

		const text = toPlaintext(ast1);
		const ast2 = assertOk<StateDiagramAST>(parse(text));

		expect(ast2.transitions).toHaveLength(ast1.transitions.length);
	});

	test("round-trip produces structurally equivalent AST with nested states", () => {
		const src = `stateDiagram-v2
  state "Active State" as Active {
    state "Idle State" as Idle
    state "Working State" as Working
    Idle --> Working: event
  }
  [*] --> Active`;

		const ast1 = assertOk<StateDiagramAST>(parse(src));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<StateDiagramAST>(parse(text));

		// Expected to have two top-level states ([*] and Active)
		expect(ast2.states.length).toBe(2);
		const activeState = ast2.states.find((s) => s.id === "Active");
		expect(activeState).toBeDefined();
		expect(activeState?.children?.length).toBe(2);
		expect(ast2.transitions).toHaveLength(2);
	});
});
