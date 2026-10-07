import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult } from "../../types.ts";
import type {
	FlowchartAST,
	FlowDirection,
	FlowEdge,
	FlowEdgeKind,
	FlowNode,
	FlowShape,
	FlowSubgraph,
} from "./flowchartTypes.ts";

const VALID_DIRECTIONS = new Set(["TB", "TD", "BT", "LR", "RL"]);

export class FlowchartParser extends DiagramParser<FlowchartAST> {
	private direction: FlowDirection = "TB";
	private nodes: FlowNode[] = [];
	private nodeMap = new Map<string, FlowNode>();
	private edges: FlowEdge[] = [];
	private subgraphs: FlowSubgraph[] = [];
	private subgraphIds = new Set<string>();
	private sourceLines: string[] = [];

	setSource(lines: string[]): this {
		this.sourceLines = lines;
		return this;
	}

	parse(): ParseResult<FlowchartAST> {
		this.skipTrivia();

		// Opening keyword: `flowchart` | `graph` followed by an optional direction.
		const first = this.peek();
		if (
			first?.type === "identifier" &&
			(first.value === "flowchart" || first.value === "graph")
		) {
			this.consume();
			const dirTok = this.peek();
			if (dirTok?.type === "identifier" && VALID_DIRECTIONS.has(dirTok.value)) {
				this.direction = normalizeDirection(dirTok.value);
				this.consume();
			}
			this.consumeIf("newline");
		}

		let title: string | undefined;
		let accTitle: string | undefined;
		let accDescr: string | undefined;

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;

			if (t.type === "identifier") {
				if (t.value === "title") {
					this.consume();
					title = this.consumeRestOfLine().trim();
					continue;
				}
				if (t.value === "accTitle") {
					this.consume();
					this.consumeColon();
					accTitle = this.consumeRestOfLine().trim();
					continue;
				}
				if (t.value === "accDescr") {
					this.consume();
					this.consumeColon();
					accDescr = this.consumeRestOfLine().trim();
					continue;
				}
				if (t.value === "subgraph") {
					this.parseSubgraph(null);
					continue;
				}
				if (t.value === "direction") {
					this.consume();
					const dir = this.peek();
					if (dir?.type === "identifier" && VALID_DIRECTIONS.has(dir.value)) {
						this.direction = normalizeDirection(dir.value);
						this.consume();
					}
					this.consumeIf("newline");
					continue;
				}
				// `end` at top level is just stray — skip
				if (t.value === "end") {
					this.consume();
					this.consumeIf("newline");
					continue;
				}
			}

			this.parseStatement(null);
		}

		return this.result({
			type: "flowchart",
			title,
			accTitle,
			accDescr,
			direction: this.direction,
			nodes: this.nodes,
			edges: this.edges,
			subgraphs: this.subgraphs,
		});
	}

	// ─── Subgraph block ───────────────────────────────────────────────────────

	private parseSubgraph(parentChildren: string[] | null): void {
		this.consume("identifier", "subgraph");

		// `subgraph Id[Label]` or `subgraph Id "Title"` or `subgraph Id`
		const idTok = this.peek();
		if (idTok?.type !== "identifier") {
			this.skipToEndOfLine();
			return;
		}
		const id = this.consume("identifier").value;

		let label: string | undefined;
		const next = this.peek();
		if (next?.type === "bracket") {
			const decoded = decodeShape(this.consume("bracket").value);
			label = decoded.label;
		} else if (next?.type === "string") {
			label = this.consume("string").value;
		}
		this.consumeIf("newline");

		// If a node with this id was auto-created by an earlier edge reference,
		// shadow it — the subgraph declaration is the canonical owner of this id
		// and we don't want to render an empty node behind the cluster rectangle.
		if (this.nodeMap.has(id)) {
			this.nodeMap.delete(id);
			const idx = this.nodes.findIndex((n) => n.id === id);
			if (idx >= 0) this.nodes.splice(idx, 1);
		}
		this.subgraphIds.add(id);

		const children: string[] = [];
		const subgraph: FlowSubgraph = { id, label, children };
		this.subgraphs.push(subgraph);
		if (parentChildren && !parentChildren.includes(id)) {
			parentChildren.push(id);
		}

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && t.value === "end") {
				this.consume();
				this.consumeIf("newline");
				return;
			}
			if (t.type === "identifier" && t.value === "subgraph") {
				this.parseSubgraph(children);
				continue;
			}
			if (t.type === "identifier" && t.value === "direction") {
				this.consume();
				const dir = this.peek();
				if (dir?.type === "identifier" && VALID_DIRECTIONS.has(dir.value)) {
					subgraph.direction = normalizeDirection(dir.value);
					this.consume();
				}
				this.consumeIf("newline");
				continue;
			}
			this.parseStatement(children);
		}
	}

	// ─── Edge / node chain ───────────────────────────────────────────────────

	private parseStatement(parentChildren: string[] | null): void {
		this.skipTrivia();
		const t = this.peek();
		if (!t) return;
		if (t.type !== "identifier") {
			this.skipToEndOfLine();
			return;
		}

		const first = this.parseNode(parentChildren);
		if (!first) {
			this.skipToEndOfLine();
			return;
		}

		let prevId = first.id;
		while (!this.isAtEnd()) {
			const arrowTok = this.peek();
			if (!arrowTok) break;
			if (arrowTok.type === "newline" || arrowTok.type === "comment") {
				this.consume();
				break;
			}
			if (arrowTok.type === "arrow" || arrowTok.type === "labeled-arrow") {
				const edgeMeta = decodeArrow(this.consume().value);
				const nextNode = this.parseNode(parentChildren);
				if (!nextNode) break;
				this.edges.push({
					from: prevId,
					to: nextNode.id,
					kind: edgeMeta.kind,
					label: edgeMeta.label,
				});
				prevId = nextNode.id;
				continue;
			}
			// Anything else: stop parsing this chain.
			break;
		}
		this.consumeIf("newline");
	}

	private parseNode(parentChildren: string[] | null): { id: string } | null {
		const idTok = this.peek();
		if (idTok?.type !== "identifier") return null;
		const id = this.consume("identifier").value;

		// Subgraph IDs reference the cluster as a whole rather than a node — we
		// return the id (so the edge chain can continue) but consume any shape
		// literal as the subgraph label rather than producing a node.
		if (this.subgraphIds.has(id)) {
			const next = this.peek();
			if (next?.type === "bracket") this.consume();
			return { id };
		}

		let shape: FlowShape | undefined;
		let label: string | undefined;
		const next = this.peek();
		if (next?.type === "bracket") {
			const decoded = decodeShape(this.consume("bracket").value);
			shape = decoded.shape;
			label = decoded.label;
		}

		const existing = this.nodeMap.get(id);
		if (existing) {
			// First declaration wins for shape/label.
			if (existing.shape === "rect" && shape && shape !== "rect") {
				existing.shape = shape;
			}
			if (!existing.label && label) {
				existing.label = label;
			}
		} else {
			const node: FlowNode = {
				id,
				label,
				shape: shape ?? "rect",
			};
			this.nodes.push(node);
			this.nodeMap.set(id, node);
		}

		if (parentChildren && !parentChildren.includes(id)) {
			parentChildren.push(id);
		}

		return { id };
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private consumeColon(): void {
		const next = this.peek();
		if (next?.type === "identifier" && next.value === ":") {
			this.consume();
		}
	}

	private consumeRestOfLine(): string {
		const firstToken = this.peek();
		if (!firstToken || firstToken.type === "newline") {
			this.consumeIf("newline");
			return "";
		}
		const sourceLine = this.sourceLines[firstToken.line - 1];
		if (sourceLine !== undefined) {
			while (true) {
				const t = this.peek();
				if (!t || t.type === "newline") break;
				this.consume();
			}
			this.consumeIf("newline");
			return sourceLine.slice(firstToken.col - 1).trim();
		}
		const parts: string[] = [];
		while (true) {
			const t = this.peek();
			if (!t || t.type === "newline") break;
			parts.push(t.value);
			this.consume();
		}
		this.consumeIf("newline");
		return parts.join(" ");
	}
}

// ─── Shape literal decoding ────────────────────────────────────────────────

export function decodeShape(literal: string): {
	shape: FlowShape;
	label: string;
} {
	if (literal.startsWith("([") && literal.endsWith("])")) {
		return { shape: "stadium", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("[[") && literal.endsWith("]]")) {
		return { shape: "subroutine", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("[(") && literal.endsWith(")]")) {
		return { shape: "cylinder", label: literal.slice(2, -2) };
	}
	// Triple-paren (double-circle) must be checked before single double-paren
	// so the inner pair isn't consumed as a regular circle.
	if (literal.startsWith("(((") && literal.endsWith(")))")) {
		return { shape: "double-circle", label: literal.slice(3, -3) };
	}
	if (literal.startsWith("((") && literal.endsWith("))")) {
		return { shape: "circle", label: literal.slice(2, -2) };
	}
	if (literal.startsWith(">") && literal.endsWith("]")) {
		return { shape: "asymmetric", label: literal.slice(1, -1) };
	}
	if (literal.startsWith("{{") && literal.endsWith("}}")) {
		return { shape: "hexagon", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("[/") && literal.endsWith("/]")) {
		return { shape: "parallelogram", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("[\\") && literal.endsWith("\\]")) {
		return { shape: "parallelogram-alt", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("[/") && literal.endsWith("\\]")) {
		return { shape: "trapezoid", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("[\\") && literal.endsWith("/]")) {
		return { shape: "trapezoid-alt", label: literal.slice(2, -2) };
	}
	if (literal.startsWith("(") && literal.endsWith(")")) {
		return { shape: "round", label: literal.slice(1, -1) };
	}
	if (literal.startsWith("{") && literal.endsWith("}")) {
		return { shape: "diamond", label: literal.slice(1, -1) };
	}
	if (literal.startsWith("[") && literal.endsWith("]")) {
		return { shape: "rect", label: literal.slice(1, -1) };
	}
	return { shape: "rect", label: literal };
}

// ─── Arrow decoding ────────────────────────────────────────────────────────

export function decodeArrow(value: string): {
	kind: FlowEdgeKind;
	label?: string;
} {
	// Labeled form: `arrow|label|` — split on the first `|`.
	const barIdx = value.indexOf("|");
	if (barIdx !== -1) {
		const arrowStr = value.slice(0, barIdx);
		const lastBar = value.lastIndexOf("|");
		const label = value.slice(barIdx + 1, lastBar);
		return { kind: arrowKindOf(arrowStr), label };
	}
	return { kind: arrowKindOf(value) };
}

function arrowKindOf(arrow: string): FlowEdgeKind {
	if (arrow.startsWith("-.")) return "dotted";
	if (arrow.startsWith("==")) return "thick";
	if (/^-+$/.test(arrow)) return "line";
	return "arrow";
}

function normalizeDirection(dir: string): FlowDirection {
	// `TD` is Mermaid's alias for `TB`.
	if (dir === "TD") return "TB";
	return dir as FlowDirection;
}
