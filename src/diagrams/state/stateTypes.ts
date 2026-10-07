import type { DiagramAST } from "../../types.ts";

export type StateDiagramAST = DiagramAST & {
	type: "stateDiagram";
	states: StateNode[];
	transitions: Transition[];
	notes: StateNote[];
};

export type StateNode = {
	id: string;
	label?: string;
	kind: "state" | "choice" | "fork" | "join" | "start" | "end";
	/** Nested state machine (concurrent or sequential). */
	children?: StateNode[];
	concurrency?: boolean; // true = concurrent sections separated by --
};

export type Transition = {
	from: string;
	to: string;
	label?: string;
};

export type StateNote = {
	position: "left of" | "right of";
	state: string;
	text: string;
};
