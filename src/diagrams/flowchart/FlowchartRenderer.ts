import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { computeFanLanes } from "../../edges.ts";
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
	buildContainmentMap,
	partitionEdgesByScope,
	ROOT_SCOPE,
	type ScopePhantom,
} from "../../scope.ts";
import { COLOR_EDGE, COLOR_EDGE_THICK, PADDING_OUTER } from "../../style.ts";
import {
	arrowMarker,
	edgeLabel,
	estimateTextWidth,
	renderCompoundFrame,
	renderTitle,
	svgEsc,
} from "../../svg.ts";
import type {
	FlowchartAST,
	FlowEdge,
	FlowEdgeKind,
	FlowNode,
	FlowShape,
	FlowSubgraph,
} from "./flowchartTypes.ts";

// ─── Layout constants (diagram-specific) ────────────────────────────────────

const NODE_HORIZONTAL_PAD = 18;
const NODE_HEIGHT = 40;
/** Diamonds (decision nodes) render closer to square so the rotated-rect
 * shape reads as a diamond rather than a flat rhombus. Height tracks width
 * but never drops below the floor or exceeds the cap. */
const DIAMOND_HEIGHT_MIN = 64;
const DIAMOND_HEIGHT_MAX = 120;
const DIAMOND_HEIGHT_RATIO = 0.55;
/** Cylinders (databases) get extra height so the top/bottom ellipses read
 * clearly. */
const CYLINDER_HEIGHT = 64;
/** Half-height of the top/bottom ellipses on cylinder shapes. Larger values
 * make the cylinder read more as a "database" shape rather than a rounded
 * rectangle. */
const CYLINDER_ELLIPSE_RY = 10;

const RANK_GAP_Y = 56;
const NODE_GAP_X = 32;

/** Header strip height inside a compound subgraph (the title bar). */
const COMPOUND_HEADER = 26;
/** Padding between the header and the inner layout. */
const COMPOUND_TOP_INNER_PAD = 12;
/** Padding between the inner layout's bottom and the compound's bottom edge. */
const COMPOUND_BOTTOM_PAD = 14;
/** Left/right padding between the inner layout and the compound's side edges. */
const COMPOUND_SIDE_PAD = 28;

const EDGE_LABEL_OFFSET = 6;

// ─── Layout types ────────────────────────────────────────────────────────────

interface LayoutNode {
	id: string;
	kind: "node" | "virtual" | "compound";
	width: number;
	height: number;
	/** Set when `kind === "node"`. */
	node?: FlowNode;
	/** Set when `kind === "compound"`. Inner layout of the subgraph's children;
	 * its `width`/`height` determine this compound's overall size. */
	innerLayout?: LayoutResult;
	/** Compound label (the subgraph's display name). */
	label?: string;
}

interface Placement {
	node: LayoutNode;
	x: number;
	y: number;
	cx: number;
	cy: number;
}

interface InternalEdge {
	from: string;
	to: string;
	label?: string;
	kind: FlowEdgeKind;
	isBack: boolean;
	chain?: string[];
	/** Reference back to the originating AST edge. */
	original: FlowEdge;
	/** Phantom edges represent cross-scope connections at their LCA scope so
	 * the parent's rank/ordering pass treats compound containers as proper
	 * upstream/downstream of their cross-scope partners. Phantoms are never
	 * rendered — the real cross-scope path is drawn by `renderCrossScopeEdge`. */
	phantom?: boolean;
}

interface LayoutResult {
	placements: Map<string, Placement>;
	edges: InternalEdge[];
	width: number;
	height: number;
}

// ─── Edge rendering ──────────────────────────────────────────────────────────

interface EdgeAnchor {
	x: number;
	y: number;
	side: "top" | "bottom";
	/** Center of the underlying box; useful for routing reference. */
	refX: number;
	refY: number;
}

// ─── Class entry point ──────────────────────────────────────────────────────

export class FlowchartRenderer extends DiagramRenderer<FlowchartAST> {
	/** Map from any node-or-subgraph id to its enclosing scope id (parent
	 * subgraph id, or `ROOT_SCOPE`). Used both for scope-partitioning edges
	 * and for `findPlacement` recursion. */
	private readonly containing: Map<string, string>;
	/** Edges with both endpoints in the same scope (where the endpoint is the
	 * subgraph itself for any edge that targets a subgraph by id). */
	private readonly edgesByScope: Map<string, FlowEdge[]>;
	/** Edges whose endpoints live in different scopes — rendered separately
	 * after the per-scope layouts are placed. */
	private readonly crossScopeEdges: FlowEdge[];
	/** Per-LCA-scope projection of each cross-scope edge as a phantom between
	 * the immediate-child ancestors. Phantoms feed ranking/ordering only. */
	private readonly phantomsByScope: Map<string, ScopePhantom<FlowEdge>[]>;
	private readonly layout: LayoutResult;
	protected readonly width: number;
	protected readonly height: number;

	constructor(ast: FlowchartAST) {
		super(ast);
		this.containing = buildContainmentMap(ast.subgraphs);
		const partitioned = partitionEdgesByScope(
			ast.edges,
			this.containing,
			(e) => ({ from: e.from, to: e.to }),
		);
		this.edgesByScope = partitioned.byScope;
		this.crossScopeEdges = partitioned.crossScope;
		this.phantomsByScope = partitioned.phantomsByScope;
		this.layout = this.layoutScope(ROOT_SCOPE, ast.nodes, ast.subgraphs);
		this.width = this.layout.width + PADDING_OUTER * 2;
		this.height = this.layout.height + this.topOffset() + PADDING_OUTER;
	}

	protected override renderDefs(): string {
		return `${arrowMarker("flow-arr")}${arrowMarker("flow-arr-thick", COLOR_EDGE_THICK)}`;
	}

	protected renderBody(): string {
		const topOffset = this.topOffset();
		const inner: string[] = [];

		inner.push(
			renderTitle(
				this.titleText(),
				this.layout.width / 2,
				-topOffset + PADDING_OUTER - 12,
			),
		);

		// Compound backgrounds (rendered before nodes/edges so they sit beneath).
		this.renderCompoundBackgrounds(this.layout, 0, 0, inner);
		// Edges in every scope, walked recursively.
		this.renderEdgesRecursive(this.layout, 0, 0, inner);
		// Cross-scope edges (one scope's inside connecting to another scope).
		this.renderCrossScopeEdges(inner);
		// Foreground nodes (real shape rendering).
		this.renderLayoutNodes(this.layout, 0, 0, inner);

		return [
			`<g transform="translate(${PADDING_OUTER}, ${topOffset})">`,
			...inner,
			`</g>`,
		].join("\n");
	}

	toPlaintext(): string {
		const ast = this.ast;
		const lines: string[] = [`flowchart ${ast.direction}`];
		if (ast.title) lines.push(`  title ${ast.title}`);
		if (ast.accTitle) lines.push(`  accTitle: ${ast.accTitle}`);
		if (ast.accDescr) lines.push(`  accDescr: ${ast.accDescr}`);

		const memberOf = new Map<string, string>();
		for (const sg of ast.subgraphs) {
			for (const c of sg.children) memberOf.set(c, sg.id);
		}

		const emitted = new Set<string>();

		const nodeDecl = (node: FlowNode): string => {
			const label = node.label ?? node.id;
			return `${node.id}${this.openerFor(node.shape)}${label}${this.closerFor(node.shape)}`;
		};
		const emitNode = (id: string, indent: string): void => {
			if (emitted.has(id)) return;
			const node = ast.nodes.find((n) => n.id === id);
			if (!node) return;
			emitted.add(id);
			lines.push(`${indent}${nodeDecl(node)}`);
		};
		const emitEdge = (e: FlowEdge, indent: string): void => {
			const labelPart = e.label ? `|${e.label}|` : "";
			lines.push(
				`${indent}${e.from} ${this.arrowFor(e.kind)}${labelPart} ${e.to}`,
			);
		};

		for (const sg of ast.subgraphs) {
			const header = sg.label
				? `subgraph ${sg.id}[${sg.label}]`
				: `subgraph ${sg.id}`;
			lines.push(`  ${header}`);
			if (sg.direction) lines.push(`    direction ${sg.direction}`);
			for (const childId of sg.children) emitNode(childId, "    ");
			for (const e of ast.edges) {
				if (memberOf.get(e.from) === sg.id && memberOf.get(e.to) === sg.id) {
					emitEdge(e, "    ");
				}
			}
			lines.push(`  end`);
		}

		for (const node of ast.nodes) {
			if (memberOf.has(node.id)) continue;
			emitNode(node.id, "  ");
		}

		for (const e of ast.edges) {
			const fromSg = memberOf.get(e.from);
			const toSg = memberOf.get(e.to);
			if (fromSg && fromSg === toSg) continue;
			emitEdge(e, "  ");
		}

		return lines.join("\n");
	}

	// Containment + scope-partitioning lifted to `src/scope.ts` and shared
	// with the class diagram. See `buildContainmentMap` /
	// `partitionEdgesByScope` calls in the constructor above.

	// ─── Recursive scope layout ──────────────────────────────────────────────

	/** Lay out a single scope. Real nodes in this scope become leaf layout
	 * nodes; child subgraphs are laid out recursively and inserted as sized
	 * compound nodes. The shared layout pipeline then ranks/orders/places
	 * the whole thing in one pass — compounds participate as atomic boxes,
	 * which is what makes the resulting subgraph rendering tight. */
	private layoutScope(
		scopeId: string,
		allNodes: FlowNode[],
		allSubgraphs: FlowSubgraph[],
	): LayoutResult {
		const layoutNodes: LayoutNode[] = [];

		for (const n of allNodes) {
			if ((this.containing.get(n.id) ?? ROOT_SCOPE) !== scopeId) continue;
			layoutNodes.push({
				id: n.id,
				kind: "node",
				width: this.shapeWidth(n),
				height: this.shapeHeight(n),
				node: n,
			});
		}

		for (const sg of allSubgraphs) {
			if ((this.containing.get(sg.id) ?? ROOT_SCOPE) !== scopeId) continue;
			const innerLayout = this.layoutScope(sg.id, allNodes, allSubgraphs);
			const labelText = sg.label ?? sg.id;
			const labelW =
				Math.ceil(estimateTextWidth(labelText)) + COMPOUND_SIDE_PAD * 2;
			const innerW = Math.max(innerLayout.width, labelW);
			const compoundW = innerW + COMPOUND_SIDE_PAD * 2;
			const compoundH =
				innerLayout.height +
				COMPOUND_HEADER +
				COMPOUND_TOP_INNER_PAD +
				COMPOUND_BOTTOM_PAD;
			layoutNodes.push({
				id: sg.id,
				kind: "compound",
				width: compoundW,
				height: compoundH,
				innerLayout,
				label: labelText,
			});
		}

		const scopeEdges = this.edgesByScope.get(scopeId) ?? [];
		const internalEdges: InternalEdge[] = scopeEdges.map((e) => ({
			from: e.from,
			to: e.to,
			label: e.label,
			kind: e.kind,
			isBack: false,
			original: e,
		}));
		// Phantoms for cross-scope edges whose LCA is this scope. They feed
		// the rank/ordering pass so compounds rank above their downstream
		// out-of-scope targets and below their upstream out-of-scope sources.
		for (const ph of this.phantomsByScope.get(scopeId) ?? []) {
			internalEdges.push({
				from: ph.from,
				to: ph.to,
				kind: "arrow",
				isBack: false,
				original: ph.original,
				phantom: true,
			});
		}

		const back = classifyBackEdges(layoutNodes, internalEdges);
		for (const e of internalEdges) {
			if (back.has(e) || e.from === e.to) e.isBack = true;
		}

		const forward = internalEdges.filter((e) => !e.isBack);
		const ranks = assignRanks(layoutNodes, forward);

		const virtualNodes = insertVirtualNodes<LayoutNode, InternalEdge>(
			internalEdges,
			ranks,
			(id) => ({ id, kind: "virtual", width: 1, height: 1 }),
		);

		const allLayoutNodes = [...layoutNodes, ...virtualNodes];
		const segmentEdges = buildSegmentEdges(internalEdges);

		const groups = new Map<number, LayoutNode[]>();
		for (const n of allLayoutNodes) {
			const r = ranks.get(n.id) ?? 0;
			const list = groups.get(r) ?? [];
			list.push(n);
			groups.set(r, list);
		}
		const sortedRanks = [...groups.keys()].sort((a, b) => a - b);

		const lanes = this.computeLanes(allLayoutNodes, internalEdges, scopeEdges);
		// Lane is the primary tiebreaker; for tied lanes, return 0 so the
		// stable sort preserves the rank's current order across sweeps.
		reorderRanksByMedian(groups, sortedRanks, segmentEdges, (a, b) => {
			const la = lanes.get(a.id) ?? 0;
			const lb = lanes.get(b.id) ?? 0;
			return la - lb;
		});

		const { placements, width, height } = assignColumnPositions(
			groups,
			sortedRanks,
			RANK_GAP_Y,
			NODE_GAP_X,
		);
		barycenterLoneRanks(placements, segmentEdges, sortedRanks, groups);

		return { placements, edges: internalEdges, width, height };
	}

	// ─── Recursive placement lookup ──────────────────────────────────────────

	/** Look up a placement by id anywhere in the nested layout, returning its
	 * geometry in root coordinates. */
	private findPlacement(
		layout: LayoutResult,
		id: string,
		offsetX: number,
		offsetY: number,
	):
		| { node: LayoutNode; x: number; y: number; cx: number; cy: number }
		| undefined {
		const direct = layout.placements.get(id);
		if (direct) {
			return {
				node: direct.node,
				x: direct.x + offsetX,
				y: direct.y + offsetY,
				cx: direct.cx + offsetX,
				cy: direct.cy + offsetY,
			};
		}
		for (const p of layout.placements.values()) {
			if (p.node.kind === "compound" && p.node.innerLayout) {
				const childOX = p.x + offsetX + COMPOUND_SIDE_PAD;
				const childOY =
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD;
				const hit = this.findPlacement(
					p.node.innerLayout,
					id,
					childOX,
					childOY,
				);
				if (hit) return hit;
			}
		}
		return undefined;
	}

	// ─── Rendering: walk layouts recursively ─────────────────────────────────

	/** Background pass: draw each compound's rectangle + header. Recurses so
	 * nested compounds get their own boxes. Runs before edges and leaf nodes
	 * so cluster fills sit beneath everything. */
	private renderCompoundBackgrounds(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		for (const p of layout.placements.values()) {
			if (p.node.kind !== "compound") continue;
			const x = p.x + offsetX;
			const y = p.y + offsetY;
			out.push(
				renderCompoundFrame({
					x,
					y,
					width: p.node.width,
					height: p.node.height,
					headerHeight: COMPOUND_HEADER,
					label: p.node.label ?? p.node.id,
				}),
			);
			if (p.node.innerLayout) {
				this.renderCompoundBackgrounds(
					p.node.innerLayout,
					x + COMPOUND_SIDE_PAD,
					y + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					out,
				);
			}
		}
	}

	/** Render leaf nodes (the actual shape SVG) by walking the nested
	 * layouts. Compound nodes themselves are drawn by
	 * `renderCompoundBackgrounds`; here we only emit shapes for `kind: "node"`. */
	private renderLayoutNodes(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		for (const p of layout.placements.values()) {
			if (p.node.kind === "node" && p.node.node) {
				this.renderNode(
					{
						node: p.node,
						x: p.x + offsetX,
						y: p.y + offsetY,
						cx: p.cx + offsetX,
						cy: p.cy + offsetY,
					},
					out,
				);
			} else if (p.node.kind === "compound" && p.node.innerLayout) {
				this.renderLayoutNodes(
					p.node.innerLayout,
					p.x + offsetX + COMPOUND_SIDE_PAD,
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					out,
				);
			}
		}
	}

	/** Render edges in every scope, recursively. Each scope's edges use that
	 * scope's placements (compounds appear as ordinary placements there). */
	private renderEdgesRecursive(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		// Recurse into compound children first.
		for (const p of layout.placements.values()) {
			if (p.node.kind === "compound" && p.node.innerLayout) {
				this.renderEdgesRecursive(
					p.node.innerLayout,
					p.x + offsetX + COMPOUND_SIDE_PAD,
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					out,
				);
			}
		}
		// Edges in this scope. One render call per AST edge. Phantoms are
		// rank-only and rendered separately as cross-scope paths.
		const seen = new Set<FlowEdge>();
		const originals: FlowEdge[] = [];
		for (const e of layout.edges) {
			if (e.phantom) continue;
			if (seen.has(e.original)) continue;
			seen.add(e.original);
			originals.push(e.original);
		}
		const fanExits = this.computeFanExits(originals, layout);
		for (const orig of originals) {
			const internal = layout.edges.find((x) => x.original === orig);
			if (!internal) continue;
			const fromAnchor = this.anchorFor(
				orig.from,
				"source",
				layout,
				offsetX,
				offsetY,
				fanExits.get(orig),
			);
			const toAnchor = this.anchorFor(
				orig.to,
				"target",
				layout,
				offsetX,
				offsetY,
				undefined,
			);
			if (!fromAnchor || !toAnchor) continue;
			this.renderEdge(orig, internal, fromAnchor, toAnchor, out);
		}
	}

	/** Cross-scope edges — those whose endpoints live in different scopes.
	 * Looked up via `findPlacement` so we can anchor on the actual nested
	 * positions and draw a single path that crosses any compound boundaries. */
	private renderCrossScopeEdges(out: string[]): void {
		for (const e of this.crossScopeEdges) {
			this.renderCrossScopeEdge(e, out);
		}
	}

	/** Route a single edge whose endpoints live in different scopes. The path
	 * exits the source's bottom, descends past any compound boundary it's
	 * crossing, jogs horizontally, then descends into the target's top. The
	 * jog Y is clamped below the source-compound bottom and above the
	 * target-compound top so the horizontal traverse always sits in the gap
	 * between clusters rather than grazing a border. */
	private renderCrossScopeEdge(orig: FlowEdge, out: string[]): void {
		const fromP = this.findPlacement(this.layout, orig.from, 0, 0);
		const toP = this.findPlacement(this.layout, orig.to, 0, 0);
		if (!fromP || !toP) return;

		const stroke = orig.kind === "thick" ? COLOR_EDGE_THICK : COLOR_EDGE;
		const strokeWidth = orig.kind === "thick" ? 2 : 1;
		const dashAttr = orig.kind === "dotted" ? ' stroke-dasharray="2,3"' : "";
		const marker =
			orig.kind === "line"
				? ""
				: ` marker-end="url(#flow-arr${orig.kind === "thick" ? "-thick" : ""})"`;

		const sx = fromP.cx;
		const sy = fromP.y + fromP.node.height;
		const ex = toP.cx;
		const ey = toP.y;

		// Jog must clear the source's enclosing compound (if any) on the way
		// down, and clear the target's enclosing compound (if any) on the way
		// up. Pad by 12px so the line sits visibly outside the cluster border.
		const CLEARANCE = 12;
		let minJogY = sy + 16;
		const sourceScope = this.containing.get(orig.from);
		if (sourceScope && sourceScope !== ROOT_SCOPE) {
			const compoundP = this.findPlacement(this.layout, sourceScope, 0, 0);
			if (compoundP) {
				minJogY = Math.max(
					minJogY,
					compoundP.y + compoundP.node.height + CLEARANCE,
				);
			}
		}
		let maxJogY = ey - 16;
		const targetScope = this.containing.get(orig.to);
		if (targetScope && targetScope !== ROOT_SCOPE) {
			const compoundP = this.findPlacement(this.layout, targetScope, 0, 0);
			if (compoundP) {
				maxJogY = Math.min(compoundP.y - CLEARANCE, maxJogY);
			}
		}
		// Prefer the jog close to the target so the long descending segment
		// runs at the source's X — usually a clear column on the side of any
		// enclosing compound — rather than at the target's X, which may pass
		// through nodes that sit above the target.
		const preferredJogY = ey - 28;
		const jogY = Math.max(minJogY, Math.min(maxJogY, preferredJogY));

		if (Math.abs(sx - ex) < 1) {
			out.push(
				`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${marker}/>`,
			);
		} else {
			const r = 6;
			const dir = ex > sx ? 1 : -1;
			const path = [
				`M ${sx} ${sy}`,
				`L ${sx} ${jogY - r}`,
				`Q ${sx} ${jogY} ${sx + dir * r} ${jogY}`,
				`L ${ex - dir * r} ${jogY}`,
				`Q ${ex} ${jogY} ${ex} ${jogY + r}`,
				`L ${ex} ${ey}`,
			].join(" ");
			out.push(
				`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${marker}/>`,
			);
		}

		if (orig.label) {
			// Same source-side descent positioning as in-scope L-shape edges.
			const labelY = jogY + 16;
			if (ex >= sx) {
				out.push(edgeLabel(ex - EDGE_LABEL_OFFSET, labelY, orig.label, "end"));
			} else {
				out.push(edgeLabel(ex + EDGE_LABEL_OFFSET, labelY, orig.label));
			}
		}
	}

	// ─── Lane assignment ─────────────────────────────────────────────────────

	/** Compute a "lane" per node. The lane reflects which fan-out branch
	 * descends to this node: when a source has multiple outgoing AST edges,
	 * the first declared edge contributes 0, the second contributes 1, etc.
	 * Lane is propagated along chains; merge nodes inherit the minimum lane
	 * of any path that reaches them. Used as the primary tiebreaker for
	 * within-rank ordering so parallel branches occupy distinct columns. */
	private computeLanes(
		allNodes: LayoutNode[],
		internalEdges: InternalEdge[],
		astEdges: FlowEdge[],
	): Map<string, number> {
		// Index of each AST edge among its source's outgoing edges, in
		// declaration order.
		const outgoingIdx = new Map<FlowEdge, number>();
		const seenPerSource = new Map<string, number>();
		for (const e of astEdges) {
			const i = seenPerSource.get(e.from) ?? 0;
			outgoingIdx.set(e, i);
			seenPerSource.set(e.from, i + 1);
		}

		// Build forward adjacency over segment edges (chain steps), tagging
		// each with the lane contribution it adds. Only the first segment of
		// a chain contributes (its source is a real fan-out point); subsequent
		// virtual-to-virtual or virtual-to-target steps contribute 0.
		const fwd = new Map<string, { to: string; contrib: number }[]>();
		const inDeg = new Map<string, number>();
		for (const n of allNodes) inDeg.set(n.id, 0);
		for (const e of internalEdges) {
			if (e.isBack || !e.chain || e.chain.length < 2) continue;
			// Phantoms propagate lane unchanged: the cross-scope edge isn't a
			// separately-laned outgoing of the compound, but its chain
			// virtuals still need to inherit the compound's lane so they sit
			// in the right column instead of falling back to lane 0.
			const baseContrib = e.phantom ? 0 : (outgoingIdx.get(e.original) ?? 0);
			for (let i = 0; i < e.chain.length - 1; i++) {
				const from = e.chain[i] ?? "";
				const to = e.chain[i + 1] ?? "";
				const contrib = i === 0 ? baseContrib : 0;
				const list = fwd.get(from) ?? [];
				list.push({ to, contrib });
				fwd.set(from, list);
				inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
			}
		}

		const lanes = new Map<string, number>();
		const queue: string[] = [];
		for (const n of allNodes) {
			if ((inDeg.get(n.id) ?? 0) === 0) {
				lanes.set(n.id, 0);
				queue.push(n.id);
			}
		}
		while (queue.length > 0) {
			const cur = queue.shift() as string;
			const curLane = lanes.get(cur) ?? 0;
			for (const { to, contrib } of fwd.get(cur) ?? []) {
				const newLane = curLane + contrib;
				const existing = lanes.get(to);
				if (existing === undefined || newLane < existing) {
					lanes.set(to, newLane);
				}
				const rem = (inDeg.get(to) ?? 0) - 1;
				inDeg.set(to, rem);
				if (rem === 0) queue.push(to);
			}
		}
		// Any nodes not reached (cyclic remnants, isolated) default to 0.
		for (const n of allNodes) {
			if (!lanes.has(n.id)) lanes.set(n.id, 0);
		}
		return lanes;
	}

	/** For each source with multiple outgoing edges in this scope, distribute
	 * exit X positions along the source's bottom edge so labels and jogs
	 * don't pile up. X is returned in scope-local coordinates; callers add
	 * their own offset. */
	/** When a source has multiple outgoing edges, decide the X each edge
	 * leaves the source at. Delegates to the shared `computeFanLanes`
	 * helper — same algorithm class diagrams use for fan-in entry lanes. */
	private computeFanExits(
		originals: FlowEdge[],
		layout: LayoutResult,
	): Map<FlowEdge, number> {
		return computeFanLanes<FlowEdge>({
			edges: originals,
			groupBy: (e) => e.from,
			anchor: (sourceId) => {
				const p = layout.placements.get(sourceId);
				if (!p) return undefined;
				return { x: p.x, width: p.node.width, cx: p.cx };
			},
			aimAt: (e) => layout.placements.get(e.to)?.cx,
		});
	}

	/** Compute an edge endpoint anchor in root coordinates. Compound nodes
	 * are first-class placements in this scope, so a single lookup handles
	 * both leaf nodes and compounds — the boundary attachment falls out of
	 * the compound's own width/height. */
	private anchorFor(
		id: string,
		role: "source" | "target",
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		fanX: number | undefined,
	): EdgeAnchor | null {
		const p = layout.placements.get(id);
		if (!p) return null;
		const topY = p.y + offsetY;
		const acx = p.cx + offsetX;
		const acy = p.cy + offsetY;
		const shape = p.node.node?.shape;
		const w = p.node.width;
		const h = p.node.height;

		if (role === "target") {
			// Diamonds enter on the upper outline: target X is the source's
			// fan-aimed center, projected onto the slanted upper edges.
			if (shape === "diamond") {
				const projected = this.diamondEdgePoint(acx, topY, w, h, acx, "top");
				return {
					x: projected.x,
					y: projected.y,
					side: "top",
					refX: acx,
					refY: acy,
				};
			}
			// Cylinders enter on the top ellipse — the curve peaks above the
			// bbox top at center and drops back to the body shoulders at the
			// sides.
			if (shape === "cylinder") {
				const projected = this.cylinderEdgePoint(acx, topY, w, h, acx, "top");
				return {
					x: projected.x,
					y: projected.y,
					side: "top",
					refX: acx,
					refY: acy,
				};
			}
			return { x: acx, y: topY, side: "top", refX: acx, refY: acy };
		}

		const exitX = fanX !== undefined ? fanX + offsetX : acx;
		if (shape === "diamond") {
			const projected = this.diamondEdgePoint(acx, topY, w, h, exitX, "bottom");
			return {
				x: projected.x,
				y: projected.y,
				side: "bottom",
				refX: acx,
				refY: acy,
			};
		}
		if (shape === "cylinder") {
			const projected = this.cylinderEdgePoint(
				acx,
				topY,
				w,
				h,
				exitX,
				"bottom",
			);
			return {
				x: projected.x,
				y: projected.y,
				side: "bottom",
				refX: acx,
				refY: acy,
			};
		}
		return {
			x: exitX,
			y: topY + h,
			side: "bottom",
			refX: acx,
			refY: acy,
		};
	}

	/** Project a desired X onto a cylinder's top or bottom ellipse. The
	 * bezier-drawn ellipse peaks `0.1625 * ry` past the bbox edge at the
	 * center and meets the body shoulders (`y + ry` / `y + h - ry`) at the
	 * sides. We approximate the curve with a true ellipse — close enough that
	 * an arrow's start/end follows the visible outline. */
	private cylinderEdgePoint(
		cx: number,
		topY: number,
		w: number,
		h: number,
		desiredX: number,
		side: "top" | "bottom",
	): { x: number; y: number } {
		const ry = CYLINDER_ELLIPSE_RY;
		const halfW = w / 2;
		const dx = Math.max(-halfW, Math.min(halfW, desiredX - cx));
		const t = Math.abs(dx) / halfW;
		// Bezier control points at ±ry*0.55 produce a peak 0.1625*ry past the
		// bbox edge — total ellipse depth from the shoulder is therefore
		// ry + 0.1625*ry.
		const depth = ry * 1.1625;
		const shoulderY = side === "top" ? topY + ry : topY + h - ry;
		const dir = side === "top" ? -1 : 1;
		const y = shoulderY + dir * depth * Math.sqrt(1 - t * t);
		return { x: cx + dx, y };
	}

	/** Project a desired X onto a diamond's upper or lower outline. The diamond
	 * has corners at top (cx, y), right (x+w, cy), bottom (cx, y+h), left
	 * (x, cy). On either the upper or lower outline, Y rises toward `cy` as
	 * X moves away from the center. */
	private diamondEdgePoint(
		cx: number,
		topY: number,
		w: number,
		h: number,
		desiredX: number,
		side: "top" | "bottom",
	): { x: number; y: number } {
		const halfW = w / 2;
		const halfH = h / 2;
		const dx = Math.max(-halfW, Math.min(halfW, desiredX - cx));
		const t = Math.abs(dx) / halfW; // 0 at center point, 1 at side point
		const cy = topY + halfH;
		const peakY = side === "top" ? topY : topY + h;
		// Linear interpolation between peak (t=0) and side point (t=1).
		const y = peakY + (cy - peakY) * t;
		return { x: cx + dx, y };
	}

	private renderEdge(
		orig: FlowEdge,
		internal: InternalEdge,
		from: EdgeAnchor,
		to: EdgeAnchor,
		out: string[],
	): void {
		const stroke = orig.kind === "thick" ? COLOR_EDGE_THICK : COLOR_EDGE;
		const strokeWidth = orig.kind === "thick" ? 2 : 1;
		const dashAttr = orig.kind === "dotted" ? ' stroke-dasharray="2,3"' : "";
		const marker =
			orig.kind === "line"
				? ""
				: ` marker-end="url(#flow-arr${orig.kind === "thick" ? "-thick" : ""})"`;

		if (orig.from === orig.to) {
			// Self-loop on right of source.
			const sx = from.refX;
			const sy = from.refY - 4;
			const ex = from.refX;
			const ey = from.refY + 4;
			const bulge = 16;
			out.push(
				`<path d="M ${sx} ${sy} C ${sx + bulge * 2} ${sy - bulge}, ${ex + bulge * 2} ${ey + bulge}, ${ex} ${ey}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${marker}/>`,
			);
			if (orig.label) {
				out.push(edgeLabel(sx + bulge * 2 + 6, from.refY + 4, orig.label));
			}
			return;
		}

		const sx = from.x;
		const sy = from.y;
		const ex = to.x;
		const ey = to.y;

		// Back-edge route on the right side.
		if (internal.isBack) {
			const r = 6;
			const apex = Math.max(sx, ex, from.refX, to.refX) + 28;
			const path = [
				`M ${sx} ${sy}`,
				`L ${apex - r} ${sy}`,
				`Q ${apex} ${sy} ${apex} ${sy - r}`,
				`L ${apex} ${ey + r}`,
				`Q ${apex} ${ey} ${apex - r} ${ey}`,
				`L ${ex} ${ey}`,
			].join(" ");
			out.push(
				`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${marker}/>`,
			);
			if (orig.label) {
				out.push(
					edgeLabel(apex + EDGE_LABEL_OFFSET, (sy + ey) / 2 + 4, orig.label),
				);
			}
			return;
		}

		// Straight vertical.
		if (Math.abs(sx - ex) < 1) {
			out.push(
				`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${marker}/>`,
			);
			if (orig.label) {
				// Anchor near the source instead of the midpoint so a long
				// descent doesn't orphan the label far from the decision.
				out.push(edgeLabel(sx + EDGE_LABEL_OFFSET, sy + 14, orig.label));
			}
			return;
		}

		// L-shape: vertical down from source, horizontal jog near the source,
		// then long vertical descent to the target.
		const jogY = sy + 16;
		const r = 6;
		const dir = ex > sx ? 1 : -1;
		const path = [
			`M ${sx} ${sy}`,
			`L ${sx} ${jogY - r}`,
			`Q ${sx} ${jogY} ${sx + dir * r} ${jogY}`,
			`L ${ex - dir * r} ${jogY}`,
			`Q ${ex} ${jogY} ${ex} ${jogY + r}`,
			`L ${ex} ${ey}`,
		].join(" ");
		out.push(
			`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${marker}/>`,
		);
		if (orig.label) {
			// Label rides next to the descending segment near the top of the
			// drop, on the source-facing side of the turn.
			const labelY = jogY + 16;
			if (dir > 0) {
				out.push(edgeLabel(ex - EDGE_LABEL_OFFSET, labelY, orig.label, "end"));
			} else {
				out.push(edgeLabel(ex + EDGE_LABEL_OFFSET, labelY, orig.label));
			}
		}
	}

	// ─── Node rendering ──────────────────────────────────────────────────────────

	private shapeWidth(node: FlowNode): number {
		const label = node.label ?? node.id;
		const min = node.shape === "circle" ? NODE_HEIGHT + 8 : 60;
		return Math.max(
			min,
			Math.ceil(estimateTextWidth(label)) + NODE_HORIZONTAL_PAD * 2,
		);
	}

	/** Per-shape height. Diamonds taper to roughly square so the rotated-rect
	 * outline reads as a diamond; cylinders get extra height for the top/bottom
	 * ellipses; circles match the shape width. Everything else uses the
	 * default. */
	private shapeHeight(node: FlowNode): number {
		switch (node.shape) {
			case "diamond":
				return Math.max(
					DIAMOND_HEIGHT_MIN,
					Math.min(
						DIAMOND_HEIGHT_MAX,
						this.shapeWidth(node) * DIAMOND_HEIGHT_RATIO,
					),
				);
			case "cylinder":
				return CYLINDER_HEIGHT;
			case "circle":
			case "double-circle":
				return this.shapeWidth(node);
			default:
				return NODE_HEIGHT;
		}
	}

	private renderNode(p: Placement, out: string[]): void {
		const node = p.node.node;
		if (!node) return;
		const x = p.x;
		const y = p.y;
		const w = p.node.width;
		const h = p.node.height;
		const cx = p.cx;
		const cy = p.cy;
		const label = node.label ?? node.id;
		const stroke = "#1f2937";
		const fill = "#ffffff";

		switch (node.shape) {
			case "rect":
				out.push(
					`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			case "round":
				out.push(
					`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			case "stadium":
				out.push(
					`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			case "subroutine":
				out.push(
					`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
					`<line x1="${x + 6}" y1="${y}" x2="${x + 6}" y2="${y + h}" stroke="${stroke}" stroke-width="1.2"/>`,
					`<line x1="${x + w - 6}" y1="${y}" x2="${x + w - 6}" y2="${y + h}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			case "cylinder": {
				const ry = CYLINDER_ELLIPSE_RY;
				// Outer outline: top ellipse → right side → bottom ellipse → left side.
				// `C` cubic curves give a fuller, more elliptical top/bottom than
				// the previous `Q` quadratics, so the cylinder reads clearly as a
				// database shape rather than a rounded rect.
				const path = [
					`M ${x} ${y + ry}`,
					`C ${x} ${y - ry * 0.55}, ${x + w} ${y - ry * 0.55}, ${x + w} ${y + ry}`,
					`L ${x + w} ${y + h - ry}`,
					`C ${x + w} ${y + h + ry * 0.55}, ${x} ${y + h + ry * 0.55}, ${x} ${y + h - ry}`,
					`Z`,
				].join(" ");
				// Horizon line: front face of the top ellipse, mirrors the top
				// outline so the cylinder has a clear cap.
				const horizon = [
					`M ${x} ${y + ry}`,
					`C ${x} ${y + ry * 2.55}, ${x + w} ${y + ry * 2.55}, ${x + w} ${y + ry}`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
					`<path d="${horizon}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "circle": {
				const r = Math.max(w, h) / 2;
				out.push(
					`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "double-circle": {
				const r = Math.max(w, h) / 2;
				out.push(
					`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
					`<circle cx="${cx}" cy="${cy}" r="${r - 5}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "asymmetric": {
				// Flag-shape rectangle with a chevron pointing into the left edge.
				const chevron = 12;
				const path = [
					`M ${x + chevron} ${y}`,
					`L ${x + w} ${y}`,
					`L ${x + w} ${y + h}`,
					`L ${x + chevron} ${y + h}`,
					`L ${x} ${cy}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "diamond": {
				const path = [
					`M ${cx} ${y}`,
					`L ${x + w} ${cy}`,
					`L ${cx} ${y + h}`,
					`L ${x} ${cy}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "hexagon": {
				const ix = 10;
				const path = [
					`M ${x + ix} ${y}`,
					`L ${x + w - ix} ${y}`,
					`L ${x + w} ${cy}`,
					`L ${x + w - ix} ${y + h}`,
					`L ${x + ix} ${y + h}`,
					`L ${x} ${cy}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "parallelogram": {
				const skew = 12;
				const path = [
					`M ${x + skew} ${y}`,
					`L ${x + w} ${y}`,
					`L ${x + w - skew} ${y + h}`,
					`L ${x} ${y + h}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "parallelogram-alt": {
				const skew = 12;
				const path = [
					`M ${x} ${y}`,
					`L ${x + w - skew} ${y}`,
					`L ${x + w} ${y + h}`,
					`L ${x + skew} ${y + h}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "trapezoid": {
				const skew = 12;
				const path = [
					`M ${x + skew} ${y}`,
					`L ${x + w - skew} ${y}`,
					`L ${x + w} ${y + h}`,
					`L ${x} ${y + h}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
			case "trapezoid-alt": {
				const skew = 12;
				const path = [
					`M ${x} ${y}`,
					`L ${x + w} ${y}`,
					`L ${x + w - skew} ${y + h}`,
					`L ${x + skew} ${y + h}`,
					`Z`,
				].join(" ");
				out.push(
					`<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
				);
				break;
			}
		}
		// Cylinder text sits between the horizon line and the bottom ellipse,
		// not at the bounding-rect center — otherwise it appears too close to
		// the top cap.
		const textYOffset =
			node.shape === "cylinder" ? CYLINDER_ELLIPSE_RY * 0.6 : 0;
		out.push(
			`<text x="${cx}" y="${cy + 4 + textYOffset}" text-anchor="middle">${svgEsc(label)}</text>`,
		);
	}

	// ─── toPlaintext helpers ─────────────────────────────────────────────────────

	private openerFor(shape: FlowShape): string {
		switch (shape) {
			case "rect":
				return "[";
			case "round":
				return "(";
			case "stadium":
				return "([";
			case "subroutine":
				return "[[";
			case "cylinder":
				return "[(";
			case "circle":
				return "((";
			case "double-circle":
				return "(((";
			case "diamond":
				return "{";
			case "hexagon":
				return "{{";
			case "parallelogram":
				return "[/";
			case "parallelogram-alt":
				return "[\\";
			case "trapezoid":
				return "[/";
			case "trapezoid-alt":
				return "[\\";
			case "asymmetric":
				return ">";
		}
	}

	private closerFor(shape: FlowShape): string {
		switch (shape) {
			case "rect":
				return "]";
			case "round":
				return ")";
			case "stadium":
				return "])";
			case "subroutine":
				return "]]";
			case "cylinder":
				return ")]";
			case "circle":
				return "))";
			case "double-circle":
				return ")))";
			case "diamond":
				return "}";
			case "hexagon":
				return "}}";
			case "parallelogram":
				return "/]";
			case "parallelogram-alt":
				return "\\]";
			case "trapezoid":
				return "\\]";
			case "trapezoid-alt":
				return "/]";
			case "asymmetric":
				return "]";
		}
	}

	private arrowFor(kind: FlowEdgeKind): string {
		switch (kind) {
			case "arrow":
				return "-->";
			case "line":
				return "---";
			case "thick":
				return "==>";
			case "dotted":
				return "-.->";
		}
	}
}
