import type { DiagramAST } from "../../types.ts";

export type FlowchartAST = DiagramAST & {
	type: "flowchart";
	direction: FlowDirection;
	nodes: FlowNode[];
	edges: FlowEdge[];
	subgraphs: FlowSubgraph[];
};

/** Layout direction. Mermaid `TD` is an alias for `TB` — we normalize to `TB`. */
export type FlowDirection = "TB" | "BT" | "LR" | "RL";

export type FlowNode = {
	id: string;
	label?: string;
	shape: FlowShape;
};

export type FlowShape =
	| "rect" // [...]
	| "round" // (...)
	| "stadium" // ([...])
	| "subroutine" // [[...]]
	| "cylinder" // [(...)]
	| "circle" // ((...))
	| "double-circle" // (((...)))
	| "diamond" // {...}
	| "hexagon" // {{...}}
	| "parallelogram" // [/.../]
	| "parallelogram-alt" // [\...\]
	| "trapezoid" // [/...\]
	| "trapezoid-alt" // [\.../]
	| "asymmetric"; // >...]

export type FlowEdge = {
	from: string;
	to: string;
	label?: string;
	kind: FlowEdgeKind;
};

export type FlowEdgeKind =
	| "arrow" // -->
	| "line" // ---
	| "thick" // ==>
	| "dotted"; // -.->

export type FlowSubgraph = {
	id: string;
	label?: string;
	direction?: FlowDirection;
	/** IDs of nodes and nested subgraphs contained in this subgraph. */
	children: string[];
};
