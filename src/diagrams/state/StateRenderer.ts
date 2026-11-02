import { DiagramRenderer } from "../../DiagramRenderer.ts";
import {
	type RoutedEdge,
	type RouteEdge,
	type RoutePlacement,
	routeEdges,
	translatePath,
} from "../../edgeRouter.ts";
import {
	assignColumnPositions,
	assignRanks,
	barycenterLoneRanks,
	buildSegmentEdges,
	classifyBackEdges,
	insertVirtualNodes,
	reorderRanksByMedian,
} from "../../layout.ts";
import {
	COLOR_COMPOUND_HEADER_FILL,
	COLOR_EDGE,
	COLOR_TEXT_DIM,
	FONT_SIZE_LABEL,
	PADDING_OUTER,
	RADIUS_COMPOUND,
} from "../../style.ts";
import {
	arrowMarker,
	edgeLabel,
	estimateTextWidth,
	renderCompoundFrame,
	renderStickyNote,
	renderTitle,
	svgEsc,
} from "../../svg.ts";
import type {
	StateDiagramAST,
	StateNode,
	StateNote,
	Transition,
} from "./stateTypes.ts";

// ─── Layout constants (diagram-specific; style tokens come from ../../style.ts) ───

const STATE_HORIZONTAL_PAD = 18;
const STATE_HEIGHT = 36;

const RANK_GAP_Y = 56;
const NODE_GAP_X = 32;

const COMPOUND_HEADER = 26;
const COMPOUND_BOTTOM_PAD = 16;
const COMPOUND_SIDE_PAD = 50; // wide enough for twin-edge labels (e.g. "start work" / "done") to fit inside
const COMPOUND_TOP_INNER_PAD = 14;

const MARKER_RADIUS = 8;
/** How far each arc of a twin pair bows from the straight line. */
const TWIN_BOW = 14;
const BACK_CHANNEL_OFFSET = 24;

const NOTE_PAD = 12;
const NOTE_GAP = 24;

const ROOT_SCOPE = "__root__";
// ─── Types ───────────────────────────────────────────────────────────────────

type SyntheticKind =
	| "marker-start"
	| "marker-end"
	| "state"
	| "compound"
	| "virtual";

interface LayoutNode {
	id: string;
	kind: SyntheticKind;
	originalId: string;
	label?: string;
	width: number;
	height: number;
	innerLayout?: LayoutResult;
}

interface Placement {
	node: LayoutNode;
	x: number;
	y: number;
	cx: number;
	cy: number;
}

interface InternalTx {
	from: string;
	to: string;
	label?: string;
	isBack: boolean;
	/**
	 * Full chain through any virtual nodes inserted to keep the edge from
	 * cutting through intermediate-rank boxes. Always [from, …, to]; length 2
	 * for short edges, longer when virtual nodes are inserted.
	 */
	chain?: string[];
}

interface LayoutResult {
	placements: Map<string, Placement>;
	transitions: InternalTx[];
	routed: RoutedEdge[];
	width: number;
	height: number;
}

interface NotePosition {
	x: number;
	y: number;
	shiftedAroundBlocker: boolean;
}

// ─── Class entry point ──────────────────────────────────────────────────────

export class StateRenderer extends DiagramRenderer<StateDiagramAST> {
	private readonly layout: LayoutResult;
	protected readonly width: number;
	protected readonly height: number;
	private readonly offsetX: number;

	constructor(ast: StateDiagramAST) {
		super(ast);
		const containing = this.buildContainmentMap(ast.states);
		const scopedTx = this.partitionTransitions(ast.transitions, containing);
		this.layout = this.layoutScope(ast.states, scopedTx, ROOT_SCOPE);

		const noteOverflow = this.computeNoteOverflow(ast.notes, this.layout);
		const contentLeft = -noteOverflow.left;
		const contentRight = this.layout.width + noteOverflow.right;
		this.width = contentRight - contentLeft + PADDING_OUTER * 2;
		this.height = this.layout.height + this.topOffset() + PADDING_OUTER;
		this.offsetX = PADDING_OUTER - contentLeft;
	}

	protected override renderDefs(): string {
		return arrowMarker("state-arr");
	}

	protected renderBody(): string {
		const layout = this.layout;
		const topOffset = this.topOffset();

		const bg: string[] = [];
		const nodes: string[] = [];
		this.renderLayoutNodes(layout, 0, 0, bg, nodes);

		const edges: string[] = [];
		this.renderLayoutEdges(layout, 0, 0, edges);

		const noteParts: string[] = [];
		for (const note of this.ast.notes) {
			this.renderNote(note, layout, noteParts);
		}

		return [
			`<g transform="translate(${this.offsetX}, ${topOffset})">`,
			renderTitle(
				this.titleText(),
				layout.width / 2,
				-topOffset + PADDING_OUTER - 12,
			),
			...bg,
			...edges,
			...nodes,
			...noteParts,
			`</g>`,
		].join("\n");
	}

	toPlaintext(): string {
		const ast = this.ast;
		const lines: string[] = ["stateDiagram-v2"];
		if (ast.title) lines.push(`  title ${ast.title}`);
		if (ast.accTitle) lines.push(`  accTitle: ${ast.accTitle}`);
		if (ast.accDescr) lines.push(`  accDescr: ${ast.accDescr}`);

		for (const s of ast.states) {
			lines.push(...this.stateNodeToLines(s, "  "));
		}
		for (const t of ast.transitions) {
			const label = t.label ? `: ${t.label}` : "";
			lines.push(`  ${t.from} --> ${t.to}${label}`);
		}
		for (const n of ast.notes) {
			lines.push(`  note ${n.position} ${n.state}: ${n.text}`);
		}

		return lines.join("\n");
	}

	// ─── Containment + scope partitioning ────────────────────────────────────────

	private buildContainmentMap(states: StateNode[]): Map<string, string> {
		const map = new Map<string, string>();
		function visit(state: StateNode, scope: string): void {
			if (state.id !== "[*]") map.set(state.id, scope);
			if (state.children) {
				for (const c of state.children) visit(c, state.id);
			}
		}
		for (const s of states) visit(s, ROOT_SCOPE);
		return map;
	}

	private partitionTransitions(
		transitions: Transition[],
		containing: Map<string, string>,
	): Map<string, Transition[]> {
		const out = new Map<string, Transition[]>();
		out.set(ROOT_SCOPE, []);
		for (const t of transitions) {
			const scope = this.scopeOfTransition(t, containing);
			const list = out.get(scope) ?? [];
			list.push(t);
			out.set(scope, list);
		}
		return out;
	}

	private scopeOfTransition(
		t: Transition,
		containing: Map<string, string>,
	): string {
		const fromScope = t.from === "[*]" ? null : containing.get(t.from);
		const toScope = t.to === "[*]" ? null : containing.get(t.to);
		if (fromScope && toScope) return fromScope;
		return fromScope ?? toScope ?? ROOT_SCOPE;
	}

	// ─── Per-scope layout (recursive for compounds) ──────────────────────────────

	private layoutScope(
		states: StateNode[],
		scopedTx: Map<string, Transition[]>,
		scope: string,
	): LayoutResult {
		const scopeStates =
			scope === ROOT_SCOPE
				? states.filter((s) => s.id !== "[*]")
				: (this.findChildren(states, scope) ?? []);

		const txInScope = scopedTx.get(scope) ?? [];

		const layoutNodes: LayoutNode[] = scopeStates.map((s) =>
			this.buildLayoutNode(s, states, scopedTx),
		);

		const { rewrittenTx, syntheticNodes } = this.splitStarEndpoints(
			txInScope,
			scope,
		);
		layoutNodes.push(...syntheticNodes);

		return this.layoutFlatList(layoutNodes, rewrittenTx);
	}

	private findChildren(
		states: StateNode[],
		id: string,
	): StateNode[] | undefined {
		for (const s of states) {
			if (s.id === id) return s.children ?? [];
			if (s.children) {
				const hit = this.findChildren(s.children, id);
				if (hit) return hit;
			}
		}
		return undefined;
	}

	private buildLayoutNode(
		state: StateNode,
		allStates: StateNode[],
		scopedTx: Map<string, Transition[]>,
	): LayoutNode {
		const label = state.label ?? state.id;
		const labelWidth = Math.max(
			60,
			Math.ceil(estimateTextWidth(label)) + STATE_HORIZONTAL_PAD * 2,
		);

		if (state.children && state.children.length > 0) {
			const innerLayout = this.layoutScope(allStates, scopedTx, state.id);
			const innerWidth = Math.max(innerLayout.width, labelWidth);
			const compoundWidth = innerWidth + COMPOUND_SIDE_PAD * 2;
			const compoundHeight =
				innerLayout.height +
				COMPOUND_HEADER +
				COMPOUND_TOP_INNER_PAD +
				COMPOUND_BOTTOM_PAD;
			return {
				id: state.id,
				kind: "compound",
				originalId: state.id,
				label,
				width: compoundWidth,
				height: compoundHeight,
				innerLayout,
			};
		}

		return {
			id: state.id,
			kind: "state",
			originalId: state.id,
			label,
			width: labelWidth,
			height: STATE_HEIGHT,
		};
	}

	private splitStarEndpoints(
		transitions: Transition[],
		scope: string,
	): {
		rewrittenTx: InternalTx[];
		syntheticNodes: LayoutNode[];
	} {
		// One shared start marker and one shared end marker per scope. Multiple
		// transitions referencing [*] in the same scope all connect to the same
		// marker — matches Mermaid's convention and avoids bullseye clutter.
		const syntheticNodes: LayoutNode[] = [];
		const rewrittenTx: InternalTx[] = [];
		const startId = `__start__${scope}`;
		const endId = `__end__${scope}`;
		let startCreated = false;
		let endCreated = false;
		for (const t of transitions) {
			let from = t.from;
			let to = t.to;
			if (from === "[*]") {
				if (!startCreated) {
					syntheticNodes.push({
						id: startId,
						kind: "marker-start",
						originalId: "[*]",
						width: MARKER_RADIUS * 2,
						height: MARKER_RADIUS * 2,
					});
					startCreated = true;
				}
				from = startId;
			}
			if (to === "[*]") {
				if (!endCreated) {
					syntheticNodes.push({
						id: endId,
						kind: "marker-end",
						originalId: "[*]",
						width: MARKER_RADIUS * 2,
						height: MARKER_RADIUS * 2,
					});
					endCreated = true;
				}
				to = endId;
			}
			rewrittenTx.push({ from, to, label: t.label, isBack: false });
		}
		return { rewrittenTx, syntheticNodes };
	}

	// ─── Flat layout: rank, order, position ──────────────────────────────────────

	private layoutFlatList(
		nodes: LayoutNode[],
		transitions: InternalTx[],
	): LayoutResult {
		if (nodes.length === 0) {
			return {
				placements: new Map(),
				transitions: [],
				routed: [],
				width: 0,
				height: 0,
			};
		}

		const idSet = new Set(nodes.map((n) => n.id));
		const validTx = transitions.filter(
			(t) => idSet.has(t.from) && idSet.has(t.to),
		);

		const backEdges = classifyBackEdges(nodes, validTx);
		const annotatedTx: InternalTx[] = validTx.map((t) => ({
			...t,
			isBack: backEdges.has(t) || t.from === t.to,
		}));

		const forwardTx = annotatedTx.filter((t) => !t.isBack);
		const ranks = assignRanks(nodes, forwardTx);

		const virtualNodes = insertVirtualNodes<LayoutNode, InternalTx>(
			annotatedTx,
			ranks,
			(id) => ({
				id,
				kind: "virtual",
				originalId: id,
				width: 1,
				height: 1,
			}),
		);

		const allNodes = [...nodes, ...virtualNodes];
		const segmentEdges = buildSegmentEdges(annotatedTx);

		const groups = new Map<number, LayoutNode[]>();
		for (const n of allNodes) {
			const r = ranks.get(n.id) ?? 0;
			const list = groups.get(r) ?? [];
			list.push(n);
			groups.set(r, list);
		}
		const sortedRanks = [...groups.keys()].sort((a, b) => a - b);

		// No explicit tiebreaker: JS Array.sort is stable, so ties preserve the
		// current order within each rank. Across the 4 sweeps this lets each
		// sweep refine the previous sweep's result rather than collapsing back
		// to the initial declaration order.
		reorderRanksByMedian(groups, sortedRanks, segmentEdges, () => 0);

		const {
			placements,
			width: maxWidth,
			height: totalHeight,
		} = assignColumnPositions(
			groups,
			sortedRanks,
			RANK_GAP_Y,
			Math.max(NODE_GAP_X, this.twinLabelRoom(annotatedTx)),
		);

		barycenterLoneRanks(placements, segmentEdges, sortedRanks, groups);

		const { routed, shiftX, width, height } = this.routeScope(
			placements,
			annotatedTx,
			maxWidth,
			totalHeight,
		);
		if (shiftX > 0) {
			for (const p of placements.values()) {
				p.x += shiftX;
				p.cx += shiftX;
			}
		}

		return {
			placements,
			transitions: annotatedTx,
			routed,
			width,
			height,
		};
	}

	// ─── Rendering ───────────────────────────────────────────────────────────────

	private renderLayoutNodes(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		bg: string[],
		fg: string[],
	): void {
		for (const p of layout.placements.values()) {
			const px = p.x + offsetX;
			const py = p.y + offsetY;
			const cx = p.cx + offsetX;
			const cy = p.cy + offsetY;
			const n = p.node;

			if (n.kind === "virtual") {
				continue; // virtual nodes are placement helpers, not rendered
			}

			if (n.kind === "marker-start") {
				fg.push(
					`<circle cx="${cx}" cy="${cy}" r="${MARKER_RADIUS}" fill="${COLOR_COMPOUND_HEADER_FILL}"/>`,
				);
			} else if (n.kind === "marker-end") {
				fg.push(
					`<circle cx="${cx}" cy="${cy}" r="${MARKER_RADIUS}" fill="white" stroke="${COLOR_COMPOUND_HEADER_FILL}" stroke-width="1.5"/>`,
					`<circle cx="${cx}" cy="${cy}" r="${MARKER_RADIUS - 4}" fill="${COLOR_COMPOUND_HEADER_FILL}"/>`,
				);
			} else if (n.kind === "compound" && n.innerLayout) {
				bg.push(
					renderCompoundFrame({
						x: px,
						y: py,
						width: n.width,
						height: n.height,
						headerHeight: COMPOUND_HEADER,
						label: n.label ?? n.id,
					}),
				);
				const childOX =
					px +
					COMPOUND_SIDE_PAD +
					(n.width - 2 * COMPOUND_SIDE_PAD - n.innerLayout.width) / 2;
				const childOY = py + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD;
				this.renderLayoutNodes(n.innerLayout, childOX, childOY, bg, fg);
			} else {
				fg.push(
					`<rect x="${px}" y="${py}" width="${n.width}" height="${n.height}" rx="${RADIUS_COMPOUND}" ry="${RADIUS_COMPOUND}" fill="${COLOR_COMPOUND_HEADER_FILL}"/>`,
					`<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="white" font-weight="600">${svgEsc(n.label ?? n.id)}</text>`,
				);
			}
		}
	}

	/** Route one scope's transitions. Channels beside the graph may spill
	 * past the nodes; the scope grows to hold them, shifting the nodes
	 * right when the spill is on the left. */
	private routeScope(
		placements: Map<string, Placement>,
		transitions: InternalTx[],
		width: number,
		height: number,
	): { routed: RoutedEdge[]; shiftX: number; width: number; height: number } {
		const nodes = new Map<string, RoutePlacement>();
		for (const p of placements.values()) {
			nodes.set(p.node.id, {
				id: p.node.id,
				x: p.x,
				y: p.y,
				width: p.node.width,
				height: p.node.height,
				cx: p.cx,
				cy: p.cy,
				virtual: p.node.kind === "virtual",
			});
		}
		const edges: RouteEdge[] = transitions.map((t, i) => ({
			key: String(i),
			from: t.from,
			to: t.to,
			label: t.label,
			isBack: t.isBack,
			chain: t.chain,
		}));
		const result = routeEdges(nodes, edges, {
			twinBow: TWIN_BOW,
			channelOffset: BACK_CHANNEL_OFFSET,
		});
		const shiftX = Math.max(0, -result.bounds.x1);
		const routed = shiftX
			? result.edges.map((e) => ({
					...e,
					d: translatePath(e.d, shiftX, 0),
					label: e.label ? { ...e.label, x: e.label.x + shiftX } : undefined,
				}))
			: result.edges;
		return {
			routed,
			shiftX,
			width: Math.max(width, result.bounds.x2) + shiftX,
			height: Math.max(height, result.bounds.y2),
		};
	}

	private renderLayoutEdges(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		const routed = layout.routed;
		for (const e of routed) {
			out.push(
				`<path d="${translatePath(e.d, offsetX, offsetY)}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1" marker-end="url(#state-arr)"/>`,
			);
			if (e.label) {
				out.push(
					edgeLabel(
						e.label.x + offsetX,
						e.label.y + offsetY,
						e.label.text,
						e.label.anchor,
					),
				);
			}
		}
		for (const p of layout.placements.values()) {
			const n = p.node;
			if (n.kind === "compound" && n.innerLayout) {
				const childOX =
					p.x +
					offsetX +
					COMPOUND_SIDE_PAD +
					(n.width - 2 * COMPOUND_SIDE_PAD - n.innerLayout.width) / 2;
				const childOY =
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD;
				this.renderLayoutEdges(n.innerLayout, childOX, childOY, out);
			}
		}
	}

	/** Twin pairs (A→B and B→A) draw both labels beside the pair, so a
	 * column needs room for the wider of the two before its neighbour. */
	private twinLabelRoom(transitions: InternalTx[]): number {
		const pairs = new Map<string, InternalTx[]>();
		for (const t of transitions) {
			if (t.from === t.to) continue;
			const key = t.from < t.to ? `${t.from}|${t.to}` : `${t.to}|${t.from}`;
			const list = pairs.get(key) ?? [];
			list.push(t);
			pairs.set(key, list);
		}
		let room = 0;
		for (const list of pairs.values()) {
			if (list.length < 2) continue;
			for (const t of list) {
				if (!t.label) continue;
				room = Math.max(
					room,
					Math.ceil(estimateTextWidth(t.label, FONT_SIZE_LABEL)) * 2 +
						TWIN_BOW * 2,
				);
			}
		}
		return room;
	}

	private computeNotePosition(
		position: "left of" | "right of",
		target: { node: LayoutNode; x: number; y: number },
		noteWidth: number,
		noteHeight: number,
		layout: LayoutResult,
	): NotePosition {
		const targetTop = target.y;
		const targetBottom = target.y + target.node.height;
		const targetLeft = target.x;
		const targetRight = target.x + target.node.width;

		// Gather placements that overlap the target's vertical range — those are the
		// only ones that could collide horizontally with a same-row note.
		const blockers: Array<{ left: number; right: number; bottom: number }> = [];
		for (const p of layout.placements.values()) {
			if (p.x === target.x && p.y === target.y) continue;
			if (p.node.kind === "virtual") continue;
			const pTop = p.y;
			const pBottom = p.y + p.node.height;
			if (pBottom < targetTop || pTop > targetBottom) continue;
			blockers.push({
				left: p.x,
				right: p.x + p.node.width,
				bottom: pBottom,
			});
		}

		let x: number;
		if (position === "left of") {
			const onLeft = blockers
				.filter((b) => b.right <= targetLeft)
				.sort((a, b) => b.right - a.right);
			let right = targetLeft - NOTE_GAP;
			for (const b of onLeft) {
				const proposedLeft = right - noteWidth;
				if (b.right > proposedLeft) {
					right = b.left - NOTE_GAP;
				}
			}
			x = right - noteWidth;
		} else {
			const onRight = blockers
				.filter((b) => b.left >= targetRight)
				.sort((a, b) => a.left - b.left);
			let left = targetRight + NOTE_GAP;
			for (const b of onRight) {
				const proposedRight = left + noteWidth;
				if (b.left < proposedRight) {
					left = b.right + NOTE_GAP;
				}
			}
			x = left;
		}

		// Default Y: vertically centered on target.
		const defaultY = target.y + (target.node.height - noteHeight) / 2;

		// If any blocker sits in the horizontal channel between target and note,
		// shift the note vertically so the dotted attachment line angles around
		// the blocker rather than appearing to pass through it.
		const noteRight = x + noteWidth;
		const channelLeft = position === "left of" ? noteRight : targetRight;
		const channelRight = position === "left of" ? targetLeft : x;
		let maxBlockerBottom = Number.NEGATIVE_INFINITY;
		let hasInChannel = false;
		for (const b of blockers) {
			if (b.right <= channelLeft || b.left >= channelRight) continue;
			hasInChannel = true;
			if (b.bottom > maxBlockerBottom) maxBlockerBottom = b.bottom;
		}

		if (!hasInChannel) {
			return { x, y: defaultY, shiftedAroundBlocker: false };
		}

		return {
			x,
			y: maxBlockerBottom + 14,
			shiftedAroundBlocker: true,
		};
	}

	private renderNote(
		note: StateNote,
		layout: LayoutResult,
		out: string[],
	): void {
		const target = this.findPlacement(layout, note.state, 0, 0);
		if (!target) return;

		const w = Math.max(
			120,
			Math.ceil(estimateTextWidth(note.text, FONT_SIZE_LABEL)) + NOTE_PAD * 2,
		);
		const h = STATE_HEIGHT;
		const { x, y, shiftedAroundBlocker } = this.computeNotePosition(
			note.position,
			target,
			w,
			h,
			layout,
		);

		// Dotted attachment line from the note's edge to the target. When the note
		// has been shifted around a blocker, anchor on the rounded corner that
		// faces the note — at the 45° point on the corner curve — so the line
		// terminates exactly on the visible outline.
		const noteCenterY = y + h / 2;
		const targetCenterY = target.y + target.node.height / 2;
		const cornerInset = RADIUS_COMPOUND * (1 - Math.SQRT1_2); // 45° point on the curve
		let anchorX: number;
		let anchorY: number;
		if (shiftedAroundBlocker) {
			anchorY = target.y + target.node.height - cornerInset;
			anchorX =
				note.position === "left of"
					? target.x + cornerInset
					: target.x + target.node.width - cornerInset;
		} else {
			anchorY = targetCenterY;
			anchorX =
				note.position === "left of" ? target.x : target.x + target.node.width;
		}
		const noteEdgeX = note.position === "left of" ? x + w : x;
		out.push(
			`<line x1="${noteEdgeX}" y1="${noteCenterY}" x2="${anchorX}" y2="${anchorY}" stroke="${COLOR_TEXT_DIM}" stroke-width="1" stroke-dasharray="2,3"/>`,
		);
		out.push(renderStickyNote({ x, y, width: w, height: h, text: note.text }));
	}

	private findPlacement(
		layout: LayoutResult,
		id: string,
		offsetX: number,
		offsetY: number,
	): { node: LayoutNode; x: number; y: number } | undefined {
		const direct = layout.placements.get(id);
		if (direct) {
			return {
				node: direct.node,
				x: direct.x + offsetX,
				y: direct.y + offsetY,
			};
		}
		for (const p of layout.placements.values()) {
			const inner = p.node.innerLayout;
			if (!inner) continue;
			const childOX =
				p.x +
				offsetX +
				COMPOUND_SIDE_PAD +
				(p.node.width - 2 * COMPOUND_SIDE_PAD - inner.width) / 2;
			const childOY = p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD;
			const hit = this.findPlacement(inner, id, childOX, childOY);
			if (hit) return hit;
		}
		return undefined;
	}

	private computeNoteOverflow(
		notes: StateNote[],
		layout: LayoutResult,
	): { left: number; right: number } {
		let left = 0;
		let right = 0;
		for (const n of notes) {
			const target = this.findPlacement(layout, n.state, 0, 0);
			if (!target) continue;
			const w = Math.max(
				120,
				Math.ceil(estimateTextWidth(n.text, FONT_SIZE_LABEL)) + NOTE_PAD * 2,
			);
			const { x } = this.computeNotePosition(
				n.position,
				target,
				w,
				STATE_HEIGHT,
				layout,
			);
			if (n.position === "left of") {
				const need = -x;
				if (need > left) left = need;
			} else {
				const need = x + w - layout.width;
				if (need > right) right = need;
			}
		}
		return { left, right };
	}

	// ─── toPlaintext helpers ─────────────────────────────────────────────────────

	private stateNodeToLines(node: StateNode, indent: string): string[] {
		const lines: string[] = [];
		const labelPart = node.label ? `"${node.label}" as ${node.id}` : node.id;
		if (node.id === "[*]") return lines;

		if (node.children && node.children.length > 0) {
			lines.push(`${indent}state ${labelPart} {`);
			for (const child of node.children) {
				lines.push(...this.stateNodeToLines(child, `${indent}  `));
			}
			lines.push(`${indent}}`);
		} else if (node.label || node.kind !== "state") {
			const typeSuffix = node.kind !== "state" ? ` <<${node.kind}>>` : "";
			lines.push(`${indent}state ${labelPart}${typeSuffix}`);
		}
		return lines;
	}
}
