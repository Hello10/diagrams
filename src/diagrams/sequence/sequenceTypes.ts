import type { DiagramAST } from "../../types.ts";

// ─── AST types ────────────────────────────────────────────────────────────────

export type SequenceDiagramAST = DiagramAST & {
	type: "sequenceDiagram";
	/** Participants in declaration order. */
	participants: Participant[];
	/** All statements (messages, notes, activations, groups) in order. */
	statements: SequenceStatement[];
};

export type Participant = {
	actor: string; // identifier used in the diagram source
	alias?: string; // "as" alias label
	kind: "participant" | "actor";
};

export type SequenceStatement =
	| MessageStatement
	| NoteStatement
	| ActivationStatement
	| LoopStatement
	| AltStatement
	| ParStatement
	| BreakStatement
	| RectStatement
	| AutonumberStatement;

export type MessageStatement = {
	kind: "message";
	from: string;
	to: string;
	label: string;
	arrow: ArrowType;
	/** If true, this is a nested sequence within a group. */
};

/** All Mermaid-compatible sequence arrow variants. */
export type ArrowType =
	| "->" // solid line, open arrowhead
	| "->>" // solid line, filled arrowhead
	| "-->" // dashed line, open arrowhead
	| "-->>" // dashed line, filled arrowhead
	| "-x" // solid line, cross head
	| "--x" // dashed line, cross head
	| "-)" // solid line, async arrow
	| "--)"; // dashed line, async arrow

export type NoteStatement = {
	kind: "note";
	position: "over" | "left of" | "right of";
	actors: string[]; // one or two actor names
	text: string;
};

export type ActivationStatement = {
	kind: "activation";
	actor: string;
	active: boolean; // true = activate, false = deactivate
};

export type LoopStatement = {
	kind: "loop";
	label: string;
	statements: SequenceStatement[];
};

export type AltStatement = {
	kind: "alt";
	branches: { condition: string; statements: SequenceStatement[] }[];
};

export type ParStatement = {
	kind: "par";
	branches: { label: string; statements: SequenceStatement[] }[];
};

export type BreakStatement = {
	kind: "break";
	label: string;
	statements: SequenceStatement[];
};

export type RectStatement = {
	kind: "rect";
	color: string;
	statements: SequenceStatement[];
};

export type AutonumberStatement = {
	kind: "autonumber";
};
