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
import { allNodes, type Navigation, navigations } from "./uiCallouts.ts";
import { UiFrameEngine } from "./uiFrame.ts";
import { targetId, targetLabel, UiScope, type UiTarget } from "./uiScope.ts";
import { uiToPlaintext } from "./uiToPlaintext.ts";
import {
	UI_DEFAULT_THEME,
	type UiAppAST,
	type UiAST,
	type UiComponent,
} from "./uiTypes.ts";

// ─── Layout constants ────────────────────────────────────────────────────────

/** Thumbnail width for every screen node. Narrow enough that a flow of
 * twenty screens stays on one canvas. */
const THUMB_WIDTH = 220;
/** Thumbnails taller than this are clipped so one long screen does not
 * stretch the whole rank. */
const THUMB_MAX_HEIGHT = 360;
/** Placeholder frame used when a screen has no tree to draw. */
const PLACEHOLDER_HEIGHT = 200;
const THUMB_RADIUS = 0;
const LABEL_HEIGHT = 22;

/** A stub for a screen out of reach: labeled, no thumbnail. */
const STUB_HEIGHT = 56;

const RANK_GAP_Y = 72;
const NODE_GAP_X = 56;
const BACK_EDGE_OFFSET = 28;

const MUTED = "#9ca3af";
const LINE = "#d1d5db";
const SURFACE = "#f3f4f6";

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeKind = "screen" | "layout" | "stub" | "virtual";

interface LayoutNode {
	id: string;
	kind: NodeKind;
	/** The document the screen or layout is declared in. */
	doc?: UiAST;
	width: number;
	height: number;
	label?: string;
	sublabel?: string;
	/** The entry screen: drawn with a heavier border. */
	initial?: boolean;
	thumb?: { svg: string; scale: number; width: number; height: number };
}

interface InternalEdge {
	from: string;
	to: string;
	label?: string;
	isBack: boolean;
	chain?: string[];
	original: Navigation;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

/** The flow view of a UI diagram: screens as thumbnails of their tree
 * joined by the transitions whose target is a screen. Transitions
 * between states of one screen belong to the frames view. With `app`,
 * the flow spans every document of the set; a screen out of reach is a
 * stub. */
export class UiFlowRenderer extends DiagramRenderer<UiAST> {
	protected readonly width: number;
	protected readonly height: number;
	private readonly scope: UiScope;
	private readonly placements: Map<string, Placement<LayoutNode>>;
	private readonly edges: InternalEdge[];
	private readonly layoutWidth: number;
	private readonly layoutHeight: number;
	private readonly embeddedDefs: boolean;
	private readonly routed: RoutedEdge[];

	/** The interface's own color, from the document's theme. */
	private readonly ink: string;

	constructor({ ast, app }: { ast: UiAST; app?: UiAppAST }) {
		super(ast);
		this.scope = new UiScope({ ast, app });
		this.ink = ast.theme?.ink ?? UI_DEFAULT_THEME.ink;
		const nodes = this.buildNodes();
		this.embeddedDefs = nodes.some((n) => n.thumb !== undefined);
		const edges = this.buildEdges(nodes);
		const layout = this.layoutGraph(nodes, edges);
		this.placements = layout.placements;
		this.edges = layout.edges;
		this.layoutHeight = layout.height;
		const routes = this.route();
		this.routed = routes.routed;
		this.layoutWidth = routes.width;
		this.width = Math.max(routes.width, 240) + PADDING_OUTER * 2;
		this.height = routes.height + this.topOffset() + PADDING_OUTER;
	}

	/** Route every edge through the shared router. Channels for back
	 * edges may spill past the nodes on either side; the graph grows to
	 * hold them and shifts right when the spill is on the left. */
	private route(): { routed: RoutedEdge[]; width: number; height: number } {
		const nodes = new Map<string, RoutePlacement>();
		for (const p of this.placements.values()) {
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
		const edges: RouteEdge[] = this.edges.map((e, i) => ({
			key: String(i),
			from: e.from,
			to: e.to,
			label: e.label,
			isBack: e.isBack,
			chain: e.chain,
		}));
		const result = routeEdges(nodes, edges, {
			twinBow: 24,
			channelOffset: BACK_EDGE_OFFSET,
		});
		const shiftX = Math.max(0, -result.bounds.x1);
		if (shiftX > 0) {
			for (const [id, p] of this.placements) {
				this.placements.set(id, { ...p, x: p.x + shiftX, cx: p.cx + shiftX });
			}
		}
		const routed = shiftX
			? result.edges.map((e) => ({
					...e,
					d: translatePath(e.d, shiftX, 0),
					label: e.label ? { ...e.label, x: e.label.x + shiftX } : undefined,
				}))
			: result.edges;
		return {
			routed,
			width: Math.max(this.placementsWidth(), result.bounds.x2 + shiftX),
			height: Math.max(this.layoutHeight, result.bounds.y2),
		};
	}

	private placementsWidth(): number {
		let w = 0;
		for (const p of this.placements.values()) {
			if (p.node.kind === "virtual") continue;
			w = Math.max(w, p.x + p.node.width);
		}
		return w;
	}

	protected override renderDefs(): string {
		return [
			arrowMarker("ui-arr", this.ink),
			this.embeddedDefs
				? new UiFrameEngine({ ast: this.ast, app: this.scope.app }).frameDefs()
				: "",
		].join("");
	}

	/** The transitions drawn, by the names of the screens they join and
	 * the label on the edge: what the flow says, without the geometry. */
	transitions(): { from: string; to: string; label: string }[] {
		const labelOf = (id: string) => this.placements.get(id)?.node.label ?? id;
		return this.edges.map((e) => ({
			from: labelOf(e.from),
			to: labelOf(e.to),
			label: e.label ?? "",
		}));
	}

	/** The graph as a positioned group for embedding in another drawing. */
	inline(): { svg: string; width: number; height: number } {
		if (this.placements.size === 0) return { svg: "", width: 0, height: 0 };
		const parts: string[] = [];
		for (const edge of this.routed) parts.push(this.drawEdge(edge));
		for (const p of this.placements.values()) parts.push(this.drawNode(p));
		return {
			svg: parts.join("\n"),
			width: this.width - PADDING_OUTER * 2,
			height: this.layoutHeight,
		};
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
		for (const edge of this.routed) parts.push(this.drawEdge(edge));
		for (const p of this.placements.values()) parts.push(this.drawNode(p));
		parts.push("</g>");
		return parts.join("\n");
	}

	toPlaintext(): string {
		return uiToPlaintext(this.ast);
	}

	// ─── Build ─────────────────────────────────────────────────────────────────

	private buildNodes(): LayoutNode[] {
		const nodes: LayoutNode[] = [];
		const frames = new UiFrameEngine({ ast: this.ast, app: this.scope.app });
		const app = this.scope.app;
		const layoutsInUse = new Map<string, { doc: UiAST; name: string }>();
		for (const doc of this.scope.documents()) {
			for (const name of doc.order) {
				const component = doc.components[name];
				if (!component || component.route === undefined) continue;
				if (component.usesLayout) {
					const target = {
						module: component.usesLayoutModule,
						name: component.usesLayout,
					};
					const layoutDoc = this.scope.document(target.module, doc);
					if (layoutDoc)
						layoutsInUse.set(targetId(target, doc), {
							doc: layoutDoc,
							name: target.name,
						});
				}
				nodes.push({
					id: targetId({ name }, doc),
					kind: "screen",
					doc,
					width: THUMB_WIDTH,
					height: 0,
					label: name,
					sublabel: component.route,
					thumb: this.thumbnail(frames, doc, name),
					initial: app
						? app.entry !== undefined &&
							app.entry.module === doc.module &&
							app.entry.screen === name
						: name === this.ast.entry,
				});
			}
		}
		// A layout is a node like a screen: its tree with the Outlet as an
		// empty slot, and its navigation drawn as edges from it.
		for (const [id, { doc, name }] of layoutsInUse) {
			nodes.push({
				id,
				kind: "layout",
				doc,
				width: THUMB_WIDTH,
				height: 0,
				label: name,
				sublabel: "layout",
				thumb: this.thumbnail(frames, doc, name),
			});
		}
		// A screen navigated to but out of reach: a stub, once.
		const ids = new Set(nodes.map((n) => n.id));
		// Stubs pushed along the way have no document, so the walk skips
		// them.
		for (const node of nodes) {
			if (!node.doc) continue;
			for (const owner of this.owners(node.doc, node.label ?? "")) {
				for (const nav of navigations(owner.component)) {
					const target = this.scope.resolve(nav.screen, owner.doc);
					if (target.module === undefined) continue;
					const id = targetId(target, owner.doc);
					if (ids.has(id)) continue;
					ids.add(id);
					nodes.push({
						id,
						kind: "stub",
						width: THUMB_WIDTH,
						height: STUB_HEIGHT + LABEL_HEIGHT,
						label: target.name,
						sublabel: target.module,
					});
				}
			}
		}
		for (const n of nodes) {
			if (n.kind === "stub") continue;
			n.height = (n.thumb?.height ?? PLACEHOLDER_HEIGHT) + LABEL_HEIGHT;
		}
		return nodes;
	}

	private thumbnail(
		frames: UiFrameEngine,
		doc: UiAST,
		name: string,
	): LayoutNode["thumb"] {
		const frame = frames.renderFrameIn({ doc, name });
		if (!frame) return undefined;
		const scale = THUMB_WIDTH / frame.width;
		return {
			// A thumbnail is not a frame of the storyboard; it carries no
			// frame marker.
			svg: frame.svg.replace(
				/^<g data-frame="[^"]*"( data-view="[^"]*")?>/,
				"<g>",
			),
			scale,
			width: THUMB_WIDTH,
			height: Math.min(Math.round(frame.height * scale), THUMB_MAX_HEIGHT),
		};
	}

	/** A component and every component it embeds, transitively, each with
	 * the document it is declared in. Components out of reach are not
	 * owners: nothing of theirs is known. */
	private owners(
		doc: UiAST,
		name: string,
		seen = new Map<string, { doc: UiAST; component: UiComponent }>(),
	): { doc: UiAST; component: UiComponent }[] {
		const id = targetId({ name }, doc);
		const component = doc.components[name];
		if (!component || seen.has(id)) return [...seen.values()];
		seen.set(id, { doc, component });
		for (const node of allNodes(component)) {
			if (node.ref?.kind !== "component") continue;
			const childDoc = this.scope.document(node.ref.module, doc);
			if (childDoc) this.owners(childDoc, node.ref.name, seen);
		}
		return [...seen.values()];
	}

	/** Edges: every move to a screen declared by a node or by a component it
	 * embeds: `go` actions on handlers and io outcomes, and links' `to=`. A
	 * layout's navigation leaves the layout node; the screens it wraps carry
	 * no copy of it. */
	private buildEdges(nodes: LayoutNode[]): InternalEdge[] {
		const ids = new Set(nodes.map((n) => n.id));
		const out: InternalEdge[] = [];
		for (const node of nodes) {
			if (!node.doc) continue;
			const name = node.label ?? "";
			for (const owner of this.owners(node.doc, name)) {
				for (const nav of navigations(owner.component)) {
					const target: UiTarget = this.scope.resolve(nav.screen, owner.doc);
					const to = targetId(target, owner.doc);
					if (!ids.has(to)) continue;
					if (to === node.id) continue; // a self-loop says nothing
					const own = owner.doc === node.doc && owner.component.name === name;
					const ownerLabel =
						owner.doc === node.doc
							? owner.component.name
							: targetLabel({
									module: owner.doc.module,
									name: owner.component.name,
								});
					out.push({
						from: node.id,
						to,
						label: own ? nav.label : `${ownerLabel} · ${nav.label}`,
						isBack: false,
						original: nav,
					});
				}
			}
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

	// ─── Draw nodes ────────────────────────────────────────────────────────────

	private drawNode(p: Placement<LayoutNode>): string {
		const n = p.node;
		switch (n.kind) {
			case "virtual":
				return "";
			case "screen":
			case "layout":
				return this.drawScreen(p);
			case "stub":
				return this.drawStub(p);
		}
	}

	/** A screen out of reach: a dashed box with its name and module. */
	private drawStub(p: Placement<LayoutNode>): string {
		const n = p.node;
		const boxH = n.height - LABEL_HEIGHT;
		return [
			`<g data-node="${svgEsc(n.id)}" data-stub="true">`,
			`<rect x="${p.x}" y="${p.y}" width="${n.width}" height="${boxH}" rx="${THUMB_RADIUS}" fill="white" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="6,4"/>`,
			`<text x="${p.cx}" y="${p.y + boxH / 2 + 5}" text-anchor="middle" fill="${MUTED}">${svgEsc(n.label ?? n.id)}</text>`,
			`<text x="${p.cx}" y="${p.y + boxH + 15}" text-anchor="middle" font-family="${FONT_MONO}" font-size="${FONT_SIZE_LABEL}" fill="${MUTED}">${svgEsc(n.sublabel ?? "")}</text>`,
			"</g>",
		].join("\n");
	}

	private drawScreen(p: Placement<LayoutNode>): string {
		const n = p.node;
		const thumbH = n.height - LABEL_HEIGHT;
		const parts: string[] = [`<g data-node="${svgEsc(n.id)}">`];
		if (n.thumb) {
			const clipId = `ui-flow-clip-${p.node.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
			parts.push(
				`<clipPath id="${clipId}"><rect x="${p.x}" y="${p.y}" width="${n.width}" height="${thumbH}" rx="${THUMB_RADIUS}"/></clipPath>`,
				// The clip cuts the embedded frame's own border in half, so the
				// thumbnail draws its outline itself, unscaled, on top. The entry
				// screen gets a heavier one.
				`<g clip-path="url(#${clipId})"><g transform="translate(${p.x}, ${p.y}) scale(${n.thumb.scale.toFixed(4)})">${n.thumb.svg}</g></g>`,
				`<rect x="${p.x}" y="${p.y}" width="${n.width}" height="${thumbH}" rx="${THUMB_RADIUS}" fill="none" stroke="${this.ink}" stroke-width="${n.initial ? 2.5 : 1.2}"/>`,
			);
		} else {
			parts.push(
				`<rect x="${p.x}" y="${p.y}" width="${n.width}" height="${thumbH}" rx="${THUMB_RADIUS}" fill="white" stroke="${this.ink}" stroke-width="${n.initial ? 2.5 : 1.2}"/>`,
			);
			// A few content bars so the placeholder reads as a screen.
			const barX = p.x + 14;
			const barW = n.width - 28;
			parts.push(
				`<rect x="${barX}" y="${p.y + 16}" width="${barW * 0.55}" height="10" rx="0" fill="${this.ink}" opacity="0.8"/>`,
				`<rect x="${barX}" y="${p.y + 38}" width="${barW}" height="${thumbH * 0.3}" rx="0" fill="${SURFACE}" stroke="${LINE}"/>`,
				`<rect x="${barX}" y="${p.y + 38 + thumbH * 0.3 + 12}" width="${barW * 0.8}" height="8" rx="0" fill="${SURFACE}"/>`,
				`<rect x="${barX}" y="${p.y + 38 + thumbH * 0.3 + 28}" width="${barW * 0.6}" height="8" rx="0" fill="${SURFACE}"/>`,
				`<rect x="${barX}" y="${p.y + thumbH - 40}" width="${barW}" height="26" rx="0" fill="white" stroke="${this.ink}"/>`,
			);
		}
		const labelY = p.y + thumbH + 15;
		const label = n.label ?? n.id;
		parts.push(
			`<text x="${p.cx}" y="${labelY}" text-anchor="middle" font-weight="600" fill="${this.ink}">${svgEsc(label)}${n.sublabel ? `<tspan dx="8" font-family="${FONT_MONO}" font-weight="400" fill="${MUTED}">${svgEsc(n.sublabel)}</tspan>` : ""}</text>`,
			"</g>",
		);
		return parts.join("\n");
	}

	// ─── Draw edges ────────────────────────────────────────────────────────────

	private drawEdge(e: RoutedEdge): string {
		const dash = e.kind === "back" ? ' stroke-dasharray="5,3"' : "";
		const label = e.label
			? this.label(e.label.text, e.label.x, e.label.y - 4, e.label.anchor)
			: "";
		return `<path d="${e.d}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1"${dash} marker-end="url(#ui-arr)"/>${label}`;
	}

	private label(
		text: string | undefined,
		x: number,
		y: number,
		anchor: "start" | "middle" | "end",
	): string {
		if (!text) return "";
		return `<text x="${round(x)}" y="${round(y + 4)}" text-anchor="${anchor}" font-size="${FONT_SIZE_LABEL}" fill="${COLOR_LABEL}">${svgEsc(text)}</text>`;
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
