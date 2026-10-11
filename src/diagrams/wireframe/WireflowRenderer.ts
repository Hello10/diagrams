import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { computeFanLanes } from "../../edges.ts";
import {
	assignColumnPositions,
	assignRanks,
	barycenterLoneRanks,
	buildSegmentEdges,
	classifyBackEdges,
	insertVirtualNodes,
	type Placement,
	reorderRanksByMedian,
} from "../../layout.ts";
import {
	COLOR_EDGE,
	COLOR_LABEL,
	FONT_MONO,
	FONT_SIZE_LABEL,
	PADDING_OUTER,
} from "../../style.ts";
import { arrowMarker, renderTitle, svgEsc } from "../../svg.ts";
import { WIREFLOW_TERMINAL } from "./WireflowParser.ts";
import { WireframeRenderer } from "./WireframeRenderer.ts";
import { wireflowToPlaintext } from "./wireframeToPlaintext.ts";
import {
	WIREFRAME_DEFAULT_STATE,
	type WireflowAST,
	type WireflowEdge,
	type WireflowNode,
} from "./wireframeTypes.ts";

// ─── Layout constants ────────────────────────────────────────────────────────

/** Thumbnail width for every screen node. Narrow enough that a flow of
 * twenty screens stays on one canvas. */
const THUMB_WIDTH = 140;
/** Thumbnails taller than this are clipped so one long screen does not
 * stretch the whole rank. */
const THUMB_MAX_HEIGHT = 220;
/** Placeholder frame used when no wireframe is attached. */
const PLACEHOLDER_HEIGHT = 200;
const THUMB_RADIUS = 10;
const LABEL_HEIGHT = 22;

const DECISION_MIN_WIDTH = 120;
const DECISION_HEIGHT = 56;
const MARKER_RADIUS = 8;

const RANK_GAP_Y = 72;
const NODE_GAP_X = 56;
const EDGE_LABEL_PAD = 4;
const BACK_EDGE_OFFSET = 28;

const INK = "#1f2937";
const MUTED = "#9ca3af";
const LINE = "#d1d5db";
const SURFACE = "#f3f4f6";

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeKind = "screen" | "decision" | "start" | "end" | "virtual";

interface LayoutNode {
	id: string;
	kind: NodeKind;
	width: number;
	height: number;
	label?: string;
	sublabel?: string;
	question?: string;
	thumb?: { svg: string; scale: number; width: number; height: number };
}

interface InternalEdge {
	from: string;
	to: string;
	label?: string;
	isBack: boolean;
	chain?: string[];
	original: WireflowEdge;
}

const START_ID = "__start__";
const END_ID = "__end__";

// ─── Renderer ────────────────────────────────────────────────────────────────

export class WireflowRenderer extends DiagramRenderer<WireflowAST> {
	protected readonly width: number;
	protected readonly height: number;
	private readonly placements: Map<string, Placement<LayoutNode>>;
	private readonly edges: InternalEdge[];
	private readonly ranks: Map<string, number>;
	private readonly layoutWidth: number;
	private readonly embeddedDefs: boolean;
	/** Jog Y for each forward-edge segment, keyed by edge index and segment. */
	private readonly jogs = new Map<string, number>();
	/** Label Y for each back edge, spread apart so they stay legible. */
	private readonly backLabelY = new Map<InternalEdge, number>();

	constructor(ast: WireflowAST) {
		super(ast);
		const nodes = this.buildNodes();
		this.embeddedDefs = nodes.some((n) => n.thumb !== undefined);
		const edges = this.buildEdges(nodes);
		const layout = this.layoutGraph(nodes, edges);
		this.placements = layout.placements;
		this.edges = layout.edges;
		this.ranks = layout.ranks;
		this.layoutWidth = layout.width;
		this.assignJogSlots();
		this.assignBackLabels();
		// Back edges route to the right of the graph and need room for labels.
		const backLabelRoom = this.edges.some((e) => e.isBack)
			? BACK_EDGE_OFFSET + 120
			: 0;
		this.width =
			Math.max(layout.width + backLabelRoom, 240) + PADDING_OUTER * 2;
		this.height = layout.height + this.topOffset() + PADDING_OUTER;
	}

	protected override renderDefs(): string {
		return [
			arrowMarker("wireflow-arr"),
			this.embeddedDefs ? WireframeRenderer.frameDefs() : "",
		].join("");
	}

	protected renderBody(): string {
		const topOffset = this.topOffset();
		const parts: string[] = [
			`<g transform="translate(${PADDING_OUTER}, ${topOffset})">`,
			renderTitle(
				this.titleText(),
				this.layoutWidth / 2,
				-topOffset + PADDING_OUTER - 12,
			),
		];
		for (const edge of this.edges) parts.push(this.drawEdge(edge));
		for (const p of this.placements.values()) parts.push(this.drawNode(p));
		parts.push("</g>");
		return parts.join("\n");
	}

	toPlaintext(): string {
		return wireflowToPlaintext(this.ast);
	}

	// ─── Build ─────────────────────────────────────────────────────────────────

	private buildNodes(): LayoutNode[] {
		const nodes: LayoutNode[] = [];
		const renderers = new Map<string, WireframeRenderer>();

		for (const id of this.ast.order) {
			const node = this.ast.nodes[id];
			if (!node) continue;
			nodes.push(this.buildNode(node, renderers));
		}
		if (this.ast.entries.length > 0) {
			nodes.push({
				id: START_ID,
				kind: "start",
				width: MARKER_RADIUS * 2,
				height: MARKER_RADIUS * 2,
			});
		}
		if (this.ast.exits.length > 0) {
			nodes.push({
				id: END_ID,
				kind: "end",
				width: MARKER_RADIUS * 2,
				height: MARKER_RADIUS * 2,
			});
		}
		return nodes;
	}

	private buildNode(
		node: WireflowNode,
		renderers: Map<string, WireframeRenderer>,
	): LayoutNode {
		if (node.kind === "decision") {
			const width = Math.max(
				DECISION_MIN_WIDTH,
				Math.ceil(textWidth(node.question, FONT_SIZE_LABEL)) + 48,
			);
			return {
				id: node.id,
				kind: "decision",
				width,
				height: DECISION_HEIGHT,
				question: node.question,
			};
		}

		const { screen, state } = node.ref;
		const wireframe = this.ast.wireframes?.[screen];
		let thumb: LayoutNode["thumb"];
		if (wireframe) {
			let renderer = renderers.get(screen);
			if (!renderer) {
				renderer = new WireframeRenderer(wireframe);
				renderers.set(screen, renderer);
			}
			const frame = renderer.renderFrame(
				screen,
				state ?? WIREFRAME_DEFAULT_STATE,
			);
			if (frame) {
				const scale = THUMB_WIDTH / frame.width;
				thumb = {
					svg: frame.svg,
					scale,
					width: THUMB_WIDTH,
					height: Math.min(Math.round(frame.height * scale), THUMB_MAX_HEIGHT),
				};
			}
		}

		return {
			id: node.id,
			kind: "screen",
			width: THUMB_WIDTH,
			height: (thumb?.height ?? PLACEHOLDER_HEIGHT) + LABEL_HEIGHT,
			label: screen,
			sublabel: state,
			thumb,
		};
	}

	private buildEdges(nodes: LayoutNode[]): InternalEdge[] {
		const ids = new Set(nodes.map((n) => n.id));
		const out: InternalEdge[] = [];
		for (const edge of this.ast.edges) {
			const from = edge.from === WIREFLOW_TERMINAL ? START_ID : edge.from;
			const to = edge.to === WIREFLOW_TERMINAL ? END_ID : edge.to;
			if (!ids.has(from) || !ids.has(to)) continue;
			out.push({
				from,
				to,
				label: edgeLabel(edge),
				isBack: false,
				original: edge,
			});
		}
		return out;
	}

	// ─── Layout ────────────────────────────────────────────────────────────────

	private layoutGraph(
		nodes: LayoutNode[],
		edges: InternalEdge[],
	): {
		placements: Map<string, Placement<LayoutNode>>;
		edges: InternalEdge[];
		ranks: Map<string, number>;
		width: number;
		height: number;
	} {
		if (nodes.length === 0) {
			return {
				placements: new Map(),
				edges: [],
				ranks: new Map(),
				width: 0,
				height: 0,
			};
		}
		const backEdges = classifyBackEdges(nodes, edges);
		const annotated = edges.map((e) => ({
			...e,
			isBack: backEdges.has(e) || e.from === e.to,
		}));
		const forward = annotated.filter((e) => !e.isBack);
		const ranks = assignRanks(nodes, forward);
		const virtualNodes = insertVirtualNodes<LayoutNode, InternalEdge>(
			annotated,
			ranks,
			(id) => ({ id, kind: "virtual", width: 1, height: 1 }),
		);
		const all = [...nodes, ...virtualNodes];
		const segments = buildSegmentEdges(annotated);

		const groups = new Map<number, LayoutNode[]>();
		for (const n of all) {
			const r = ranks.get(n.id) ?? 0;
			const list = groups.get(r) ?? [];
			list.push(n);
			groups.set(r, list);
		}
		const sortedRanks = [...groups.keys()].sort((a, b) => a - b);
		reorderRanksByMedian(groups, sortedRanks, segments, () => 0);
		const placed = assignColumnPositions(
			groups,
			sortedRanks,
			RANK_GAP_Y,
			NODE_GAP_X,
		);
		barycenterLoneRanks(placed.placements, segments, sortedRanks, groups);

		// Center every node vertically within its rank so thumbnails of
		// different heights share a midline and edges leave from a tidy row.
		for (const r of sortedRanks) {
			const list = groups.get(r) ?? [];
			const rowH = Math.max(0, ...list.map((n) => n.height));
			for (const n of list) {
				const p = placed.placements.get(n.id);
				if (!p) continue;
				const dy = (rowH - n.height) / 2;
				placed.placements.set(n.id, { ...p, y: p.y + dy, cy: p.cy + dy });
			}
		}

		return {
			placements: placed.placements,
			edges: annotated,
			ranks,
			width: placed.width,
			height: placed.height,
		};
	}

	/** Every forward-edge segment that crosses the gap below rank `r` gets
	 * its own horizontal jog line, so two edges sharing a gap never overlap
	 * their horizontals. Slots are ordered by where the segment starts. */
	private assignJogSlots(): void {
		const bottoms = new Map<number, number>();
		const tops = new Map<number, number>();
		for (const p of this.placements.values()) {
			const r = this.ranks.get(p.node.id) ?? 0;
			bottoms.set(
				r,
				Math.max(
					bottoms.get(r) ?? Number.NEGATIVE_INFINITY,
					p.y + p.node.height,
				),
			);
			tops.set(r, Math.min(tops.get(r) ?? Number.POSITIVE_INFINITY, p.y));
		}

		const perGap = new Map<number, { key: string; x: number }[]>();
		this.edges.forEach((e, ei) => {
			if (e.isBack || e.from === e.to) return;
			const chain = e.chain ?? [e.from, e.to];
			for (let i = 0; i < chain.length - 1; i++) {
				const fromId = chain[i] ?? "";
				const toId = chain[i + 1] ?? "";
				const r = this.ranks.get(fromId) ?? 0;
				const fromX = this.placements.get(fromId)?.cx ?? 0;
				const toX = this.placements.get(toId)?.cx ?? 0;
				if (Math.abs(fromX - toX) < 1) continue; // straight drop, no jog
				const list = perGap.get(r) ?? [];
				list.push({ key: `${ei}:${i}`, x: fromX + toX / 1000 });
				perGap.set(r, list);
			}
		});

		for (const [r, list] of perGap) {
			const bottom = bottoms.get(r) ?? 0;
			const top = tops.get(r + 1) ?? bottom + RANK_GAP_Y;
			const center = (bottom + top) / 2;
			list.sort((a, b) => a.x - b.x);
			const step = Math.min(12, (top - bottom - 16) / Math.max(list.length, 1));
			list.forEach((item, k) => {
				this.jogs.set(item.key, center + (k - (list.length - 1) / 2) * step);
			});
		}
	}

	private jogY(e: InternalEdge, segment: number, fallback: number): number {
		const ei = this.edges.indexOf(e);
		return this.jogs.get(`${ei}:${segment}`) ?? fallback;
	}

	private assignBackLabels(): void {
		const items: { edge: InternalEdge; y: number }[] = [];
		for (const e of this.edges) {
			if (!e.isBack || e.from === e.to || !e.label) continue;
			const from = this.placements.get(e.from);
			const to = this.placements.get(e.to);
			if (!from || !to) continue;
			items.push({ edge: e, y: (from.cy + to.cy) / 2 });
		}
		items.sort((a, b) => a.y - b.y);
		const minGap = FONT_SIZE_LABEL + 10;
		for (let i = 1; i < items.length; i++) {
			const prev = items[i - 1];
			const cur = items[i];
			if (prev && cur && cur.y < prev.y + minGap) cur.y = prev.y + minGap;
		}
		for (const item of items) this.backLabelY.set(item.edge, item.y);
	}

	// ─── Draw nodes ────────────────────────────────────────────────────────────

	private drawNode(p: Placement<LayoutNode>): string {
		const n = p.node;
		switch (n.kind) {
			case "virtual":
				return "";
			case "start":
				return `<circle cx="${p.cx}" cy="${p.cy}" r="${MARKER_RADIUS}" fill="${INK}"/>`;
			case "end":
				return [
					`<circle cx="${p.cx}" cy="${p.cy}" r="${MARKER_RADIUS}" fill="white" stroke="${INK}" stroke-width="1.5"/>`,
					`<circle cx="${p.cx}" cy="${p.cy}" r="${MARKER_RADIUS - 4}" fill="${INK}"/>`,
				].join("");
			case "decision": {
				const hw = n.width / 2;
				return [
					`<g data-decision="${svgEsc(n.id)}">`,
					`<path d="M ${p.cx} ${p.y} L ${p.cx + hw} ${p.cy} L ${p.cx} ${p.y + n.height} L ${p.cx - hw} ${p.cy} Z" fill="white" stroke="${INK}" stroke-width="1.2"/>`,
					`<text x="${p.cx}" y="${p.cy + 4}" text-anchor="middle" font-size="${FONT_SIZE_LABEL}" fill="${INK}">${svgEsc(n.question ?? n.id)}</text>`,
					`</g>`,
				].join("");
			}
			case "screen":
				return this.drawScreen(p);
		}
	}

	private drawScreen(p: Placement<LayoutNode>): string {
		const n = p.node;
		const thumbH = n.height - LABEL_HEIGHT;
		const parts: string[] = [`<g data-node="${svgEsc(n.id)}">`];
		if (n.thumb) {
			const clipId = `wireflow-clip-${p.node.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
			parts.push(
				`<clipPath id="${clipId}"><rect x="${p.x}" y="${p.y}" width="${n.width}" height="${thumbH}" rx="${THUMB_RADIUS}"/></clipPath>`,
				`<g clip-path="url(#${clipId})"><g transform="translate(${p.x}, ${p.y}) scale(${round(n.thumb.scale)})">${n.thumb.svg}</g></g>`,
				`<rect x="${p.x}" y="${p.y}" width="${n.width}" height="${thumbH}" rx="${THUMB_RADIUS}" fill="none" stroke="${INK}" stroke-width="1.2"/>`,
			);
		} else {
			parts.push(
				`<rect x="${p.x}" y="${p.y}" width="${n.width}" height="${thumbH}" rx="${THUMB_RADIUS}" fill="white" stroke="${INK}" stroke-width="1.2"/>`,
			);
			// A few content bars so the placeholder reads as a screen.
			const barX = p.x + 14;
			const barW = n.width - 28;
			parts.push(
				`<rect x="${barX}" y="${p.y + 16}" width="${barW * 0.55}" height="10" rx="5" fill="${INK}" opacity="0.8"/>`,
				`<rect x="${barX}" y="${p.y + 38}" width="${barW}" height="${thumbH * 0.3}" rx="6" fill="${SURFACE}" stroke="${LINE}"/>`,
				`<rect x="${barX}" y="${p.y + 38 + thumbH * 0.3 + 12}" width="${barW * 0.8}" height="8" rx="4" fill="${SURFACE}"/>`,
				`<rect x="${barX}" y="${p.y + 38 + thumbH * 0.3 + 28}" width="${barW * 0.6}" height="8" rx="4" fill="${SURFACE}"/>`,
				`<rect x="${barX}" y="${p.y + thumbH - 40}" width="${barW}" height="26" rx="6" fill="white" stroke="${INK}"/>`,
			);
		}
		const labelY = p.y + thumbH + 15;
		const label = n.label ?? n.id;
		parts.push(
			`<text x="${p.cx}" y="${labelY}" text-anchor="middle" font-weight="600" fill="${INK}">${svgEsc(label)}${n.sublabel ? `<tspan font-family="${FONT_MONO}" font-weight="400" fill="${MUTED}"> ${svgEsc(n.sublabel)}</tspan>` : ""}</text>`,
			"</g>",
		);
		return parts.join("\n");
	}

	// ─── Draw edges ────────────────────────────────────────────────────────────

	private drawEdge(e: InternalEdge): string {
		const from = this.placements.get(e.from);
		const to = this.placements.get(e.to);
		if (!from || !to) return "";

		if (e.from === e.to) return this.drawSelfLoop(e, from);
		if (e.isBack) return this.drawBackEdge(e, from, to);
		if (e.chain && e.chain.length > 2) return this.drawChainedEdge(e);

		const twin = this.edges.some(
			(other) => other !== e && other.from === e.to && other.to === e.from,
		);
		const sx = (this.exitLanes.get(e) ?? from.cx) + (twin ? -8 : 0);
		const sy = from.y + from.node.height;
		const ex = (this.entryLanes.get(e) ?? to.cx) + (twin ? -8 : 0);
		const ey = to.y;

		if (Math.abs(sx - ex) < 1) {
			return [
				`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${COLOR_EDGE}" stroke-width="1" marker-end="url(#wireflow-arr)"/>`,
				this.label(e.label, sx + EDGE_LABEL_PAD, (sy + ey) / 2, "start"),
			].join("");
		}

		const r = 6;
		const jogY = this.jogY(e, 0, sy + RANK_GAP_Y / 2);
		const dir = ex > sx ? 1 : -1;
		const path = [
			`M ${sx} ${sy}`,
			`L ${sx} ${jogY - r}`,
			`Q ${sx} ${jogY} ${sx + dir * r} ${jogY}`,
			`L ${ex - dir * r} ${jogY}`,
			`Q ${ex} ${jogY} ${ex} ${jogY + r}`,
			`L ${ex} ${ey}`,
		].join(" ");
		return [
			`<path d="${path}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1" marker-end="url(#wireflow-arr)"/>`,
			this.label(e.label, (sx + ex) / 2, jogY - 4, "middle"),
		].join("");
	}

	private drawChainedEdge(e: InternalEdge): string {
		const chain = e.chain ?? [];
		const points = chain
			.map((id) => this.placements.get(id))
			.filter((p): p is Placement<LayoutNode> => p !== undefined);
		if (points.length < 2) return "";
		const first = points[0];
		const last = points[points.length - 1];
		if (!first || !last) return "";

		const r = 6;
		const path: string[] = [];
		let prevX = this.exitLanes.get(e) ?? first.cx;
		let prevY = first.y + first.node.height;
		path.push(`M ${prevX} ${prevY}`);
		for (let i = 1; i < points.length; i++) {
			const p = points[i];
			if (!p) continue;
			const isLast = i === points.length - 1;
			const cx = isLast ? (this.entryLanes.get(e) ?? p.cx) : p.cx;
			const targetY = isLast ? p.y : p.cy;
			if (Math.abs(cx - prevX) < 1) {
				path.push(`L ${cx} ${targetY}`);
			} else {
				const jogY = this.jogY(e, i - 1, (prevY + targetY) / 2);
				const dir = cx > prevX ? 1 : -1;
				path.push(
					`L ${prevX} ${jogY - r}`,
					`Q ${prevX} ${jogY} ${prevX + dir * r} ${jogY}`,
					`L ${cx - dir * r} ${jogY}`,
					`Q ${cx} ${jogY} ${cx} ${jogY + r}`,
					`L ${cx} ${targetY}`,
				);
			}
			prevX = cx;
			prevY = targetY;
		}
		const labelY =
			this.jogY(e, 0, first.y + first.node.height + RANK_GAP_Y / 2) - 4;
		const firstX = this.exitLanes.get(e) ?? first.cx;
		const second = points[1];
		const labelX = second ? (firstX + second.cx) / 2 : firstX;
		return [
			`<path d="${path.join(" ")}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1" marker-end="url(#wireflow-arr)"/>`,
			this.label(e.label, labelX, labelY, "middle"),
		].join("");
	}

	private drawBackEdge(
		e: InternalEdge,
		from: Placement<LayoutNode>,
		to: Placement<LayoutNode>,
	): string {
		// Leave the source on its right side, run up a channel to the right of
		// everything between, and enter the target on its right side.
		const sx = from.x + from.node.width;
		const sy = from.cy;
		const ex = to.x + to.node.width;
		const ey = to.cy;
		const apex =
			this.layoutWidth + BACK_EDGE_OFFSET + this.backEdgeIndex(e) * 14;
		const r = 8;
		const path = [
			`M ${sx} ${sy}`,
			`L ${apex - r} ${sy}`,
			`Q ${apex} ${sy} ${apex} ${sy - r}`,
			`L ${apex} ${ey + r}`,
			`Q ${apex} ${ey} ${apex - r} ${ey}`,
			`L ${ex} ${ey}`,
		].join(" ");
		return [
			`<path d="${path}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1" stroke-dasharray="5,3" marker-end="url(#wireflow-arr)"/>`,
			this.label(
				e.label,
				apex + EDGE_LABEL_PAD,
				this.backLabelY.get(e) ?? (sy + ey) / 2,
				"start",
			),
		].join("");
	}

	private drawSelfLoop(e: InternalEdge, p: Placement<LayoutNode>): string {
		const sx = p.x + p.node.width;
		const sy = p.cy - 10;
		const ey = p.cy + 10;
		const bulge = 24;
		return [
			`<path d="M ${sx} ${sy} C ${sx + bulge} ${sy - bulge}, ${sx + bulge} ${ey + bulge}, ${sx} ${ey}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1" marker-end="url(#wireflow-arr)"/>`,
			this.label(e.label, sx + bulge + EDGE_LABEL_PAD, p.cy, "start"),
		].join("");
	}

	private backEdgeIndex(e: InternalEdge): number {
		let i = 0;
		for (const other of this.edges) {
			if (other === e) return i;
			if (other.isBack && other.from !== other.to) i++;
		}
		return i;
	}

	/** Edge label on a white pill so it stays legible over other edges. */
	private label(
		text: string | undefined,
		x: number,
		y: number,
		anchor: "start" | "middle",
	): string {
		if (!text) return "";
		const w = textWidth(text, FONT_SIZE_LABEL) + 8;
		const h = FONT_SIZE_LABEL + 6;
		const left = anchor === "middle" ? x - w / 2 : x - 4;
		return [
			`<rect x="${round(left)}" y="${round(y - h / 2)}" width="${round(w)}" height="${h}" rx="3" fill="white" fill-opacity="0.9"/>`,
			`<text x="${x}" y="${round(y + 4)}" text-anchor="${anchor}" font-size="${FONT_SIZE_LABEL}" fill="${COLOR_LABEL}">${svgEsc(text)}</text>`,
		].join("");
	}

	// ─── Fan lanes ─────────────────────────────────────────────────────────────

	private get exitLanes(): Map<InternalEdge, number> {
		if (!this.exitLanesCache) {
			this.exitLanesCache = computeFanLanes<InternalEdge>({
				edges: this.edges.filter((e) => !e.isBack && e.from !== e.to),
				groupBy: (e) => e.from,
				anchor: (id) => this.laneAnchor(id),
				aimAt: (e) => {
					const next = e.chain && e.chain.length > 1 ? e.chain[1] : e.to;
					return next ? this.placements.get(next)?.cx : undefined;
				},
				minGap: 24,
			});
		}
		return this.exitLanesCache;
	}
	private exitLanesCache?: Map<InternalEdge, number>;

	private get entryLanes(): Map<InternalEdge, number> {
		if (!this.entryLanesCache) {
			this.entryLanesCache = computeFanLanes<InternalEdge>({
				edges: this.edges.filter((e) => !e.isBack && e.from !== e.to),
				groupBy: (e) => e.to,
				anchor: (id) => this.laneAnchor(id),
				aimAt: (e) => {
					const chain = e.chain ?? [];
					const prev = chain.length > 2 ? chain[chain.length - 2] : e.from;
					return prev ? this.placements.get(prev)?.cx : undefined;
				},
				minGap: 24,
			});
		}
		return this.entryLanesCache;
	}
	private entryLanesCache?: Map<InternalEdge, number>;

	/** Screens spread their edges along the thumbnail edge; diamonds and
	 * markers have a single vertex, so their lanes collapse to the center. */
	private laneAnchor(
		id: string,
	): { x: number; width: number; cx: number } | undefined {
		const p = this.placements.get(id);
		if (!p) return undefined;
		if (p.node.kind !== "screen") return { x: p.cx, width: 0, cx: p.cx };
		return { x: p.x, width: p.node.width, cx: p.cx };
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function edgeLabel(edge: WireflowEdge): string | undefined {
	if (edge.branch !== undefined) return edge.branch;
	if (edge.interaction) {
		return edge.trigger
			? `${edge.interaction} ${edge.trigger}`
			: edge.interaction;
	}
	return undefined;
}

function textWidth(text: string, size: number): number {
	return text.length * size * 0.56;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
