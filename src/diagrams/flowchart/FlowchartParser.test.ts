/**
 * flowchart/flowchartParser.test.ts
 *
 * Unit tests for FlowchartParser in isolation. Structural assertions on the
 * AST — not rendering or API integration.
 */

import { createParseHelper } from "../../testUtils.ts";
import { FlowchartParser } from "./FlowchartParser.ts";
import type { FlowchartAST } from "./flowchartTypes.ts";

const parse = createParseHelper<FlowchartAST, FlowchartParser>(FlowchartParser);

// ─── Header / direction ──────────────────────────────────────────────────────

describe("header", () => {
	test("flowchart TD parses with TB direction (TD is alias for TB)", () => {
		const ast = parse(`flowchart TD
  A --> B`);
		expect(ast.type).toBe("flowchart");
		expect(ast.direction).toBe("TB");
	});

	test("flowchart LR parses with LR direction", () => {
		const ast = parse(`flowchart LR
  A --> B`);
		expect(ast.direction).toBe("LR");
	});

	test("graph keyword is accepted as alias for flowchart", () => {
		const ast = parse(`graph TB
  A --> B`);
		expect(ast.type).toBe("flowchart");
		expect(ast.direction).toBe("TB");
	});

	test("missing direction defaults to TB", () => {
		const ast = parse(`flowchart
  A --> B`);
		expect(ast.direction).toBe("TB");
	});
});

// ─── Nodes ───────────────────────────────────────────────────────────────────

describe("nodes", () => {
	test("bare identifier reference creates a rect node", () => {
		const ast = parse(`flowchart TD
  A --> B`);
		const ids = ast.nodes.map((n) => n.id);
		expect(ids).toContain("A");
		expect(ids).toContain("B");
		expect(ast.nodes.every((n) => n.shape === "rect")).toBe(true);
	});

	test("each shape literal produces the correct shape kind", () => {
		const ast = parse(`flowchart TD
  R[rect]
  Ro(round)
  S([stadium])
  Sub[[subroutine]]
  Cyl[(cylinder)]
  Circ((circle))
  Dc(((double-circle)))
  D{diamond}
  H{{hexagon}}
  P[/parallelogram/]
  Pa[\\parallelogram-alt\\]
  Tr[/trapezoid\\]
  Tra[\\trapezoid-alt/]
  Asym>asymmetric]`);
		const byId = new Map(ast.nodes.map((n) => [n.id, n]));
		expect(byId.get("R")?.shape).toBe("rect");
		expect(byId.get("Ro")?.shape).toBe("round");
		expect(byId.get("S")?.shape).toBe("stadium");
		expect(byId.get("Sub")?.shape).toBe("subroutine");
		expect(byId.get("Cyl")?.shape).toBe("cylinder");
		expect(byId.get("Circ")?.shape).toBe("circle");
		expect(byId.get("Dc")?.shape).toBe("double-circle");
		expect(byId.get("D")?.shape).toBe("diamond");
		expect(byId.get("H")?.shape).toBe("hexagon");
		expect(byId.get("P")?.shape).toBe("parallelogram");
		expect(byId.get("Pa")?.shape).toBe("parallelogram-alt");
		expect(byId.get("Tr")?.shape).toBe("trapezoid");
		expect(byId.get("Tra")?.shape).toBe("trapezoid-alt");
		expect(byId.get("Asym")?.shape).toBe("asymmetric");
		expect(byId.get("Asym")?.label).toBe("asymmetric");
		expect(byId.get("Dc")?.label).toBe("double-circle");
	});

	test("shape label is extracted from literal", () => {
		const ast = parse(`flowchart TD
  Auth{Has auth header?}`);
		expect(ast.nodes[0]?.label).toBe("Has auth header?");
	});

	test("repeating an id does not duplicate the node", () => {
		const ast = parse(`flowchart TD
  A --> B
  A --> C`);
		expect(ast.nodes.filter((n) => n.id === "A")).toHaveLength(1);
	});

	test("first declaration wins for shape and label", () => {
		const ast = parse(`flowchart TD
  X[first]
  X[second]`);
		expect(ast.nodes.find((n) => n.id === "X")?.label).toBe("first");
	});
});

// ─── Edges ───────────────────────────────────────────────────────────────────

describe("edges", () => {
	test("solid arrow `-->` creates an arrow edge", () => {
		const ast = parse(`flowchart TD
  A --> B`);
		expect(ast.edges).toHaveLength(1);
		expect(ast.edges[0]?.kind).toBe("arrow");
	});

	test("solid line `---` creates a line edge (no arrowhead)", () => {
		const ast = parse(`flowchart TD
  A --- B`);
		expect(ast.edges[0]?.kind).toBe("line");
	});

	test("thick arrow `==>` creates a thick edge", () => {
		const ast = parse(`flowchart TD
  A ==> B`);
		expect(ast.edges[0]?.kind).toBe("thick");
	});

	test("dotted arrow `-.->` creates a dotted edge", () => {
		const ast = parse(`flowchart TD
  A -.-> B`);
		expect(ast.edges[0]?.kind).toBe("dotted");
	});

	test("labeled arrow `-->|label|` captures the label", () => {
		const ast = parse(`flowchart TD
  A -->|on retry| B`);
		expect(ast.edges[0]?.label).toBe("on retry");
		expect(ast.edges[0]?.kind).toBe("arrow");
	});

	test("chained edges produce one edge per segment", () => {
		const ast = parse(`flowchart TD
  A --> B --> C --> D`);
		expect(ast.edges).toHaveLength(3);
		const pairs = ast.edges.map((e) => `${e.from}->${e.to}`);
		expect(pairs).toEqual(["A->B", "B->C", "C->D"]);
	});
});

// ─── Subgraphs ───────────────────────────────────────────────────────────────

describe("subgraphs", () => {
	test("subgraph block captures id, label, and child nodes", () => {
		const ast = parse(`flowchart TD
  subgraph S[My Cluster]
    A --> B
  end`);
		expect(ast.subgraphs).toHaveLength(1);
		const sg = ast.subgraphs[0];
		expect(sg?.id).toBe("S");
		expect(sg?.label).toBe("My Cluster");
		expect(sg?.children).toEqual(expect.arrayContaining(["A", "B"]));
	});

	test("subgraph without label", () => {
		const ast = parse(`flowchart TD
  subgraph S
    A
  end`);
		const sg = ast.subgraphs[0];
		expect(sg?.id).toBe("S");
		expect(sg?.label).toBeUndefined();
	});

	test("direction override inside subgraph is captured", () => {
		const ast = parse(`flowchart TD
  subgraph S[Cluster]
    direction LR
    A --> B
  end`);
		expect(ast.subgraphs[0]?.direction).toBe("LR");
	});

	test("declaring a subgraph with an existing node id shadows the node", () => {
		const ast = parse(`flowchart TD
  X --> Y
  subgraph X[Container]
    Z
  end`);
		// X is now a subgraph, not a node
		expect(ast.nodes.find((n) => n.id === "X")).toBeUndefined();
		expect(ast.subgraphs.map((s) => s.id)).toContain("X");
	});

	test("edges between subgraph members are preserved", () => {
		const ast = parse(`flowchart TD
  subgraph S
    A --> B
    B --> C
  end`);
		const internalEdges = ast.edges.filter(
			(e) => ["A", "B", "C"].includes(e.from) && ["A", "B", "C"].includes(e.to),
		);
		expect(internalEdges).toHaveLength(2);
	});
});

// ─── Comments and metadata ───────────────────────────────────────────────────

describe("metadata", () => {
	test("comments are skipped", () => {
		const ast = parse(`flowchart TD
  %% this is a comment
  A --> B`);
		expect(ast.edges).toHaveLength(1);
	});

	test("accTitle and accDescr are captured", () => {
		const ast = parse(`flowchart TD
  accTitle: Title
  accDescr: Description
  A --> B`);
		expect(ast.accTitle).toBe("Title");
		expect(ast.accDescr).toBe("Description");
	});
});
