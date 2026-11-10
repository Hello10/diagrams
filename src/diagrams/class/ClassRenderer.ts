import type { RenderDiagnostics } from "../../diagnostics.ts";
import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { roundedPath } from "../../edgeRouter.ts";
import { computeFanLanes } from "../../edges.ts";
import {
	inflate,
	labelRect,
	type Pt,
	type Rect,
	rectsOverlap,
	segmentIntersectsRect,
	segmentRect,
} from "../../geometry.ts";
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
import {
	COLOR_COMPOUND_HEADER_FILL,
	COLOR_EDGE,
	COLOR_NODE_FILL,
	COLOR_NODE_STROKE,
	FONT_SIZE_LABEL,
	PADDING_OUTER,
	STROKE_BOLD,
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
	ClassDiagramAST,
	ClassMember,
	ClassNode,
	ClassNote,
	ClassRelationship,
	ClassRelationshipKind,
} from "./classTypes.ts";

// ─── Layout constants ────────────────────────────────────────────────────────

const CLASS_HEADER_HEIGHT = 28;
const CLASS_STEREOTYPE_HEIGHT = 14;
const CLASS_ROW_HEIGHT = 18;
const CLASS_MIN_WIDTH = 140;
const CLASS_SIDE_PAD = 14;
const CLASS_ROW_GAP = 0;
const CLASS_DIVIDER_PAD = 4;
const NOTE_WIDTH = 220;
const NOTE_LINE_HEIGHT = 16;
const NOTE_PADDING = 10;
/** Vertical gap between the main class layout and the notes band below. */
const _NOTE_BAND_TOP_GAP = 32;
/** Horizontal gap between adjacent notes within a row. */
const _NOTE_BAND_COL_GAP = 16;
/** Vertical gap between wrapped rows of notes. */
const _NOTE_BAND_ROW_GAP = 16;

const RANK_GAP_Y = 70;
const NODE_GAP_X = 60;

/** Namespace container metrics, mirroring the flowchart subgraph + state
 * compound-state values so the visual language stays consistent. */
const COMPOUND_HEADER = 26;
const COMPOUND_TOP_INNER_PAD = 12;
const COMPOUND_BOTTOM_PAD = 14;
const COMPOUND_SIDE_PAD = 24;

// ─── Marker definitions (one per relationship arrowhead) ────────────────────

const MARKER_IDS = {
	arrow: "class-arrow",
	triangle: "class-triangle",
	diamondFilled: "class-diamond-filled",
	diamondHollow: "class-diamond-hollow",
} as const;

// ─── Layout types ────────────────────────────────────────────────────────────

interface LayoutNode {
	id: string;
	kind: "class" | "virtual" | "namespace";
	width: number;
	height: number;
	class?: ClassNode;
	/** Inner layout for `kind: "namespace"`. */
	innerLayout?: LayoutResult;
	/** Display label for namespace headers. */
	label?: string;
}

interface InternalEdge {
	from: string;
	to: string;
	isBack: boolean;
	chain?: string[];
	original: ClassRelationship;
	/** Phantom edges represent cross-scope relationships at their LCA scope
	 * so the parent's ranking pass treats the namespace containers as proper
	 * upstream/downstream partners. Phantoms are never rendered — the real
	 * cross-scope path is drawn separately. */
	phantom?: boolean;
}

interface LayoutResult {
	placements: Map<string, Placement>;
	edges: InternalEdge[];
	/** The footprint of the boxes alone. */
	contentWidth: number;
	/** With room on the right for back-edge channels and self loops. */
	width: number;
	height: number;
}

/** An edge's route: forward edges drop from source bottom to target top;
 * back edges go up a channel beside their scope; self loops sit on the
 * node's right. */
interface EdgePath {
	kind: "forward" | "back" | "self";
	pts: Pt[];
	/** The channel's x, for back edges, and the x right of every channel
	 * of the scope, where its label goes. */
	channelX?: number;
	labelX?: number;
}

interface Placement {
	node: LayoutNode;
	x: number;
	y: number;
	cx: number;
	cy: number;
}

interface NotePlacement {
	note: ClassNote;
	/** Body text wrapped to the note's content width. */
	bodyLines: string[];
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Text placed beside an edge: its label and cardinalities. */
interface EdgeDecoration {
	x: number;
	y: number;
	text: string;
	anchor: "start" | "middle" | "end";
}

/** Something an edge must not pass through: a class box, or the label on
 * a namespace header. In root coordinates. */
interface Obstacle {
	id: string;
	rect: Rect;
}

/** How far an edge keeps from a box it routes beside. */
const EDGE_CLEARANCE = 12;
/** How far above a target (or below a source) the second jog of a detour
 * runs. */
const DETOUR_JOG = 14;
/** Spacing between back-edge channels beside one scope. */
const CHANNEL_STEP = 16;
/** How far a self loop reaches out from its node. */
const SELF_REACH = 24;
/** Room kept right of a scope's boxes for its channels' labels. */
const CHANNEL_LABEL_ROOM = 48;

// ─── Renderer ────────────────────────────────────────────────────────────────

export class ClassRenderer extends DiagramRenderer<ClassDiagramAST> {
	private readonly containing: Map<string, string>;
	private readonly edgesByScope: Map<string, ClassRelationship[]>;
	private readonly crossScopeEdges: ClassRelationship[];
	private readonly phantomsByScope: Map<
		string,
		ScopePhantom<ClassRelationship>[]
	>;
	private readonly layout: LayoutResult;
	/** Per-relationship fan-out / fan-in lane X positions, in ROOT
	 * coordinates. Covers all relationships across all scopes (including
	 * cross-scope), so when several edges share a source or target their
	 * exit/entry X's don't collide. */
	private readonly fanOutX: Map<ClassRelationship, number>;
	private readonly fanInX: Map<ClassRelationship, number>;
	/** Every class box and namespace label, in root coordinates. */
	private readonly obstacles: Obstacle[];
	/** Each relationship's path, in root coordinates, in paint order. */
	private readonly edgeGeoms: Map<ClassRelationship, EdgePath>;
	/** Each relationship's label and cardinalities, placed clear of boxes,
	 * other labels, and other edges where there is room. */
	private readonly decorations: Map<ClassRelationship, EdgeDecoration[]>;
	/** Relationships the layout ranked against: drawn up a channel. */
	private readonly backRels = new Set<ClassRelationship>();
	/** The scope each relationship is routed in: its own, or the lowest
	 * scope containing both ends. */
	private readonly scopeOf = new Map<ClassRelationship, string>();
	/** Channels handed out so far, per scope, and how many each has. */
	private readonly channels = new Map<string, number>();
	private readonly channelCount = new Map<string, number>();
	protected readonly width: number;
	protected readonly height: number;

	constructor(ast: ClassDiagramAST) {
		super(ast);
		this.containing = buildContainmentMap(ast.namespaces);
		const partitioned = partitionEdgesByScope(
			ast.relationships,
			this.containing,
			(r) => ({ from: r.from, to: r.to }),
		);
		this.edgesByScope = partitioned.byScope;
		this.crossScopeEdges = partitioned.crossScope;
		this.phantomsByScope = partitioned.phantomsByScope;
		this.layout = this.layoutScope(ROOT_SCOPE);
		const lanes = this.computeFanLanes();
		this.fanOutX = lanes.out;
		this.fanInX = lanes.in;
		this.obstacles = this.collectObstacles(this.layout, 0, 0);
		this.edgeGeoms = this.computeEdgeGeometry();
		this.decorations = this.placeDecorations();
		this.notePlacements = this.layoutNotes();
		// Canvas takes the larger of the class layout's footprint and the
		// notes band that sits beneath it.
		const notesBottom = this.notePlacements.reduce(
			(acc, n) => Math.max(acc, n.y + n.height),
			0,
		);
		this.width =
			Math.max(this.layout.width, this.maxNoteRowWidth()) + PADDING_OUTER * 2;
		this.height =
			Math.max(this.layout.height, notesBottom) +
			this.topOffset() +
			PADDING_OUTER;
	}

	/** Pre-computed positions for every note. Notes sit in a band below the
	 * main layout, packed left-to-right and wrapping to additional rows when
	 * the layout width is exceeded. No leader lines — each note prints
	 * `For: ClassName` inside the sticky-note shape so the visual
	 * association doesn't require routing a line that might cross unrelated
	 * classes. */
	private readonly notePlacements: NotePlacement[];

	private layoutNotes(): NotePlacement[] {
		const out: NotePlacement[] = [];
		if (this.ast.notes.length === 0) return out;

		// Occupied rectangles: every top-level class box and every namespace
		// rectangle (namespaces cover their inner classes already), and every
		// edge segment, so a note never sits on a line. Notes are added as
		// they're placed so subsequent notes can't overlap earlier ones.
		const occupied: Rect[] = [];
		for (const p of this.layout.placements.values()) {
			if (p.node.kind !== "class" && p.node.kind !== "namespace") continue;
			occupied.push({
				x: p.x,
				y: p.y,
				w: p.node.width,
				h: p.node.height,
			});
		}
		for (const { pts } of this.edgeGeoms.values()) {
			for (let i = 1; i < pts.length; i++) {
				const a = pts[i - 1] as Pt;
				const b = pts[i] as Pt;
				occupied.push(segmentRect(a, b, 6));
			}
		}

		for (const note of this.ast.notes) {
			const lines = wrapNoteText(note.text, NOTE_WIDTH - NOTE_PADDING * 2);
			// A note for a class carries the class's name as a caption, so
			// the tie reads wherever the note finds room.
			const h =
				(lines.length + (note.target ? 1 : 0)) * NOTE_LINE_HEIGHT +
				NOTE_PADDING * 2;
			const rect = this.findNotePlacement(note, h, occupied);
			out.push({
				note,
				bodyLines: lines,
				x: rect.x,
				y: rect.y,
				width: NOTE_WIDTH,
				height: h,
			});
			occupied.push(rect);
		}
		return out;
	}

	/** Pick a position for a single note. Preferred slots (in order):
	 *   1. Immediately right of the target's outer ancestor.
	 *   2. Right of any other class on the same row.
	 *   3. Below the target's outer ancestor.
	 *   4. A row below the entire layout, packed left-to-right.
	 *
	 * For each candidate the function verifies the note's rectangle doesn't
	 * intersect any occupied rect; the first fitting candidate wins. */
	private findNotePlacement(
		note: ClassNote,
		h: number,
		occupied: ReadonlyArray<Rect>,
	): Rect {
		const GAP = 18;
		const candidates: Rect[] = [];

		if (note.target) {
			const outer = this.outerBoxFor(note.target);
			if (outer) {
				// Aligned with the target's top, immediately right.
				candidates.push({
					x: outer.x + outer.w + GAP,
					y: outer.y,
					w: NOTE_WIDTH,
					h,
				});
				// Right but vertically centred — useful when the target is tall.
				candidates.push({
					x: outer.x + outer.w + GAP,
					y: outer.y + Math.max(0, (outer.h - h) / 2),
					w: NOTE_WIDTH,
					h,
				});
				// Below the target.
				candidates.push({
					x: outer.x,
					y: outer.y + outer.h + GAP,
					w: NOTE_WIDTH,
					h,
				});
				// Right of every box on the same row (some other class may sit
				// directly to the right of the target with empty space further
				// along — try those slots too).
				const sameRowBoxes = occupied
					.filter(
						(o) =>
							!rectsAreSame(o, outer) &&
							rangesOverlap(o.y, o.y + o.h, outer.y, outer.y + outer.h),
					)
					.sort((a, b) => a.x - b.x);
				for (const o of sameRowBoxes) {
					candidates.push({
						x: o.x + o.w + GAP,
						y: outer.y,
						w: NOTE_WIDTH,
						h,
					});
				}
			}
		}

		// Fallback: pack below the layout in a row, picking up where the
		// previous fallback notes left off.
		const fallbackY = this.layout.height + GAP * 2;
		let fallbackX = 0;
		for (const r of occupied) {
			if (r.y >= fallbackY - GAP) {
				fallbackX = Math.max(fallbackX, r.x + r.w + GAP);
			}
		}
		candidates.push({ x: fallbackX, y: fallbackY, w: NOTE_WIDTH, h });

		for (const c of candidates) {
			if (!overlapsAny(c, occupied)) return c;
		}
		// Last resort — use the final fallback even if it overlaps, so the
		// note still renders somewhere.
		return candidates[candidates.length - 1] as Rect;
	}

	/** Compute fan-out and fan-in X positions over every relationship in the
	 * AST. Anchors are looked up in root coordinates via `findPlacement` so
	 * cross-scope edges (which terminate on inner nodes) participate
	 * alongside same-scope edges — without this, a target with both
	 * in-scope and cross-scope inbound arrows would collide their entry X's
	 * at the target's center. */
	private computeFanLanes(): {
		out: Map<ClassRelationship, number>;
		in: Map<ClassRelationship, number>;
	} {
		const anchorOf = (id: string) => {
			const p = this.findPlacement(this.layout, id, 0, 0);
			if (!p) return undefined;
			return { x: p.x, width: p.node.width, cx: p.cx };
		};
		const aimAt = (id: string) => this.findPlacement(this.layout, id, 0, 0)?.cx;
		const fanOut = computeFanLanes<ClassRelationship>({
			edges: this.ast.relationships,
			groupBy: (r) => r.from,
			anchor: anchorOf,
			aimAt: (r) => aimAt(r.to),
		});
		const fanIn = computeFanLanes<ClassRelationship>({
			edges: this.ast.relationships,
			groupBy: (r) => r.to,
			anchor: anchorOf,
			aimAt: (r) => aimAt(r.from),
		});
		return { out: fanOut, in: fanIn };
	}

	/** The outermost root-level rectangle that contains the target id —
	 * either the target's enclosing namespace bbox (if any), or the target
	 * class's own bbox. */
	private outerBoxFor(id: string): Rect | undefined {
		const scope = this.containing.get(id);
		const outerId = scope && scope !== ROOT_SCOPE ? scope : id;
		const p = this.layout.placements.get(outerId);
		if (!p) return undefined;
		return { x: p.x, y: p.y, w: p.node.width, h: p.node.height };
	}

	private maxNoteRowWidth(): number {
		let max = 0;
		for (const np of this.notePlacements) {
			max = Math.max(max, np.x + np.width);
		}
		return max;
	}

	protected override renderDefs(): string {
		return [
			arrowMarker(MARKER_IDS.arrow),
			markerTriangle(MARKER_IDS.triangle),
			markerDiamond(MARKER_IDS.diamondFilled, COLOR_EDGE),
			markerDiamond(MARKER_IDS.diamondHollow, COLOR_NODE_FILL),
		].join("");
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

		// Layer order: namespace backgrounds → edges → class boxes → notes.
		// Edges paint before boxes so the line endpoints tuck under the class
		// outline; namespace cards paint first so everything sits on top.
		this.renderCompoundBackgrounds(this.layout, 0, 0, inner);
		for (const [r, path] of this.edgeGeoms) this.renderEdge(r, path, inner);
		this.renderClassBoxesRecursive(this.layout, 0, 0, inner);
		this.renderNotes(inner);

		return [
			`<g transform="translate(${PADDING_OUTER}, ${topOffset})">`,
			...inner,
			`</g>`,
		].join("\n");
	}

	toPlaintext(): string {
		const ast = this.ast;
		const lines: string[] = ["classDiagram"];
		if (ast.direction !== "TB") lines.push(`  direction ${ast.direction}`);
		if (ast.title) lines.push(`  title ${ast.title}`);
		if (ast.accTitle) lines.push(`  accTitle: ${ast.accTitle}`);
		if (ast.accDescr) lines.push(`  accDescr: ${ast.accDescr}`);

		// Walk classes in their declared order; namespaces wrap whichever of
		// their children appear in that pass.
		const memberOf = new Map<string, string>();
		for (const ns of ast.namespaces) {
			for (const c of ns.children) memberOf.set(c, ns.id);
		}
		const renderedClasses = new Set<string>();
		const emitClass = (cls: ClassNode, indent: string) => {
			const declName = cls.typeParam ? `${cls.id}~${cls.typeParam}~` : cls.id;
			const hasBody = cls.members.length > 0 || cls.stereotype;
			if (!hasBody) {
				lines.push(`${indent}class ${declName}`);
				return;
			}
			lines.push(`${indent}class ${declName} {`);
			if (cls.stereotype) lines.push(`${indent}  <<${cls.stereotype}>>`);
			for (const m of cls.members) {
				lines.push(`${indent}  ${visibilityChar(m)}${m.text}`);
			}
			lines.push(`${indent}}`);
		};
		for (const ns of ast.namespaces) {
			const header = ns.label
				? `namespace ${ns.id}[${ns.label}]`
				: `namespace ${ns.id}`;
			lines.push(`  ${header} {`);
			for (const childId of ns.children) {
				const cls = ast.classes.find((c) => c.id === childId);
				if (cls) {
					emitClass(cls, "    ");
					renderedClasses.add(cls.id);
				}
			}
			lines.push(`  }`);
		}
		for (const cls of ast.classes) {
			if (renderedClasses.has(cls.id)) continue;
			emitClass(cls, "  ");
		}
		for (const r of ast.relationships) {
			lines.push(`  ${formatRelationship(r)}`);
		}
		for (const note of ast.notes) {
			lines.push(
				note.target
					? `  note for ${note.target} "${note.text}"`
					: `  note "${note.text}"`,
			);
		}
		return lines.join("\n");
	}

	// ─── Recursive scope layout ──────────────────────────────────────────────

	private layoutScope(scopeId: string): LayoutResult {
		const layoutNodes: LayoutNode[] = [];

		for (const c of this.ast.classes) {
			if ((this.containing.get(c.id) ?? ROOT_SCOPE) !== scopeId) continue;
			// Wide enough that every edge sharing its top or bottom gets a
			// lane of its own (see `computeFanLanes`).
			const degree = Math.max(
				this.ast.relationships.filter((r) => r.to === c.id).length,
				this.ast.relationships.filter((r) => r.from === c.id).length,
			);
			layoutNodes.push({
				id: c.id,
				kind: "class",
				width: Math.max(classWidth(c), (degree - 1) * 18 + 12 * 2 + 8),
				height: classHeight(c),
				class: c,
			});
		}

		for (const ns of this.ast.namespaces) {
			if ((this.containing.get(ns.id) ?? ROOT_SCOPE) !== scopeId) continue;
			const innerLayout = this.layoutScope(ns.id);
			const labelText = ns.label ?? ns.id;
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
				id: ns.id,
				kind: "namespace",
				width: compoundW,
				height: compoundH,
				innerLayout,
				label: labelText,
			});
		}

		const scopeRels = this.edgesByScope.get(scopeId) ?? [];
		const internalEdges: InternalEdge[] = scopeRels.map((r) => ({
			from: r.from,
			to: r.to,
			isBack: false,
			original: r,
		}));
		for (const ph of this.phantomsByScope.get(scopeId) ?? []) {
			internalEdges.push({
				from: ph.from,
				to: ph.to,
				isBack: false,
				original: ph.original,
				phantom: true,
			});
		}

		const back = classifyBackEdges(layoutNodes, internalEdges);
		for (const e of internalEdges) {
			if (back.has(e) || e.from === e.to) e.isBack = true;
			this.scopeOf.set(e.original, scopeId);
			if (e.isBack && e.original.from !== e.original.to)
				this.backRels.add(e.original);
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

		reorderRanksByMedian(groups, sortedRanks, segmentEdges, () => 0);

		const { placements, width, height } = assignColumnPositions(
			groups,
			sortedRanks,
			RANK_GAP_Y,
			NODE_GAP_X,
		);
		barycenterLoneRanks(placements, segmentEdges, sortedRanks, groups);
		// Lone ranks may have moved past the column width.
		let contentWidth = width;
		for (const p of placements.values()) {
			if (p.node.kind === "virtual") continue;
			contentWidth = Math.max(contentWidth, p.x + p.node.width);
		}

		// Back edges climb channels right of the boxes, with their labels
		// beside them; self loops reach out from a node's right.
		const backCount = internalEdges.filter(
			(e) => e.isBack && e.from !== e.to,
		).length;
		this.channelCount.set(scopeId, backCount);
		const selfCount = internalEdges.filter((e) => e.from === e.to).length;
		const reserve = Math.max(
			backCount > 0
				? EDGE_CLEARANCE + backCount * CHANNEL_STEP + CHANNEL_LABEL_ROOM
				: 0,
			selfCount > 0 ? SELF_REACH + CHANNEL_LABEL_ROOM : 0,
		);
		return {
			placements,
			edges: internalEdges,
			contentWidth,
			width: contentWidth + reserve,
			height,
		};
	}

	/** The right edge of a scope's boxes, in root coordinates. */
	private contentRight(scopeId: string): number {
		if (scopeId === ROOT_SCOPE) return this.layout.contentWidth;
		const p = this.findPlacement(this.layout, scopeId, 0, 0);
		const inner = p?.node.innerLayout;
		if (!p || !inner) return this.layout.contentWidth;
		return p.x + COMPOUND_SIDE_PAD + inner.contentWidth;
	}

	/** Recursive placement lookup. Walks compound `innerLayout`s and returns
	 * the placement in root coordinates, accounting for each compound's
	 * header + padding offset. */
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
			if (p.node.kind === "namespace" && p.node.innerLayout) {
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

	// ─── Rendering passes ────────────────────────────────────────────────────

	private renderCompoundBackgrounds(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		for (const p of layout.placements.values()) {
			if (p.node.kind !== "namespace") continue;
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

	private renderClassBoxesRecursive(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		for (const p of layout.placements.values()) {
			if (p.node.kind === "class" && p.node.class) {
				this.renderClassBox(
					{
						node: p.node,
						x: p.x + offsetX,
						y: p.y + offsetY,
						cx: p.cx + offsetX,
						cy: p.cy + offsetY,
					},
					p.node.class,
					out,
				);
			} else if (p.node.kind === "namespace" && p.node.innerLayout) {
				this.renderClassBoxesRecursive(
					p.node.innerLayout,
					p.x + offsetX + COMPOUND_SIDE_PAD,
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					out,
				);
			}
		}
	}

	/** Every class box and namespace label in `layout`, in root
	 * coordinates. Namespace frames themselves are not obstacles: an edge
	 * into a namespace has to cross its border somewhere. */
	private collectObstacles(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
	): Obstacle[] {
		const out: Obstacle[] = [];
		for (const p of layout.placements.values()) {
			const x = p.x + offsetX;
			const y = p.y + offsetY;
			if (p.node.kind === "class") {
				out.push({
					id: p.node.id,
					rect: { x, y, w: p.node.width, h: p.node.height },
				});
			} else if (p.node.kind === "namespace" && p.node.innerLayout) {
				const label = p.node.label ?? p.node.id;
				const labelW = Math.ceil(estimateTextWidth(label)) + 8;
				out.push({
					id: `${p.node.id}#label`,
					rect: {
						x: x + p.node.width / 2 - labelW / 2,
						y,
						w: labelW,
						h: COMPOUND_HEADER,
					},
				});
				// The frame itself: in the way of an edge that connects
				// nothing inside it (see `blockers`).
				out.push({
					id: `${p.node.id}#frame`,
					rect: { x, y, w: p.node.width, h: p.node.height },
				});
				out.push(
					...this.collectObstacles(
						p.node.innerLayout,
						x + COMPOUND_SIDE_PAD,
						y + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					),
				);
			}
		}
		return out;
	}

	/** The path of every relationship: same-scope edges first, inner scopes
	 * before outer, then cross-scope edges. A path leaves the source's
	 * bottom at its fan-out lane, jogs across, and enters the target's top
	 * at its fan-in lane; where a vertical would cut through a class or a
	 * namespace label, it detours beside it. */
	private computeEdgeGeometry(): Map<ClassRelationship, EdgePath> {
		const forward = new Map<ClassRelationship, Pt[]>();
		this.scopeEdgeGeometry(this.layout, 0, 0, forward);
		this.crossScopeEdgeGeometry(forward);
		// Forward edges first, so back edges and self loops paint over them
		// and their labels give way.
		const out = new Map<ClassRelationship, EdgePath>();
		const later: ClassRelationship[] = [];
		for (const [r, pts] of forward) {
			if (r.from === r.to || this.backRels.has(r)) later.push(r);
			else out.set(r, { kind: "forward", pts });
		}
		for (const r of later) {
			const path = r.from === r.to ? this.selfLoop(r) : this.backEdge(r);
			if (path) out.set(r, path);
		}
		return out;
	}

	/** A loop on the node's side: out, down a little, back in. On the
	 * right when the loop and its label have room there, else the left. */
	private selfLoop(r: ClassRelationship): EdgePath | undefined {
		const p = this.findPlacement(this.layout, r.from, 0, 0);
		if (!p) return undefined;
		const need =
			SELF_REACH +
			6 +
			(r.label ? estimateTextWidth(r.label, FONT_SIZE_LABEL) : 0);
		const right = p.x + p.node.width;
		const room = (x: number, w: number) =>
			!this.obstacles.some(
				(o) =>
					o.id !== r.from &&
					!o.id.endsWith("#frame") &&
					rectsOverlap(o.rect, { x, y: p.cy - 8, w, h: 24 }),
			);
		// The loop goes right when it fits there, else left when that is on
		// the canvas; the label finds its own place around it.
		const onRight =
			room(right, SELF_REACH + 6) ||
			p.x - SELF_REACH - need < 0 ||
			!room(p.x - SELF_REACH - need, SELF_REACH + need);
		const edge = onRight ? right : p.x;
		const reach = onRight ? right + SELF_REACH : p.x - SELF_REACH;
		return {
			kind: "self",
			pts: [
				{ x: edge, y: p.cy - 8 },
				{ x: reach, y: p.cy - 8 },
				{ x: reach, y: p.cy + 8 },
				{ x: edge, y: p.cy + 8 },
			],
		};
	}

	/** Up a channel right of the scope's boxes. The edge leaves the
	 * source's right side and enters the target's right side when nothing
	 * stands between them and the channel; otherwise it drops into the gap
	 * below the box first, or comes in from below the target. */
	private backEdge(r: ClassRelationship): EdgePath | undefined {
		const from = this.findPlacement(this.layout, r.from, 0, 0);
		const to = this.findPlacement(this.layout, r.to, 0, 0);
		if (!from || !to) return undefined;
		const scope = this.scopeOf.get(r) ?? ROOT_SCOPE;
		const k = this.channels.get(scope) ?? 0;
		this.channels.set(scope, k + 1);
		const channelX =
			this.contentRight(scope) + EDGE_CLEARANCE + k * CHANNEL_STEP;
		const pts: Pt[] = [];

		const fromRight = { x: from.x + from.node.width, y: from.cy };
		if (this.blockers(fromRight, { x: channelX, y: from.cy }, r).length === 0) {
			pts.push(fromRight);
		} else {
			const sx = this.fanOutX.get(r) ?? from.cx;
			const gapY = from.y + from.node.height + DETOUR_JOG + k * 6;
			pts.push({ x: sx, y: from.y + from.node.height }, { x: sx, y: gapY });
		}
		pts.push({ x: channelX, y: (pts[pts.length - 1] as Pt).y });

		// Each channel enters the target at its own point, so two back
		// edges into one box do not land their arrowheads together.
		const count = this.channelCount.get(scope) ?? 1;
		const entryY = Math.max(
			to.y + 8,
			Math.min(to.cy + (k - (count - 1) / 2) * 8, to.y + to.node.height - 8),
		);
		const toRight = { x: to.x + to.node.width, y: entryY };
		if (this.blockers({ x: channelX, y: entryY }, toRight, r).length === 0) {
			pts.push({ x: channelX, y: entryY }, toRight);
		} else {
			const gapY = to.y + to.node.height + DETOUR_JOG + k * 6;
			const ex = to.x + to.node.width - 14 - k * 10;
			pts.push(
				{ x: channelX, y: gapY },
				{ x: ex, y: gapY },
				{ x: ex, y: to.y + to.node.height },
			);
		}
		return {
			kind: "back",
			pts,
			channelX,
			labelX:
				this.contentRight(scope) +
				EDGE_CLEARANCE +
				((this.channelCount.get(scope) ?? 1) - 1) * CHANNEL_STEP,
		};
	}

	private scopeEdgeGeometry(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: Map<ClassRelationship, Pt[]>,
	): void {
		// Recurse into compound children first so the inner edges paint
		// before their containing scope's edges.
		for (const p of layout.placements.values()) {
			if (p.node.kind === "namespace" && p.node.innerLayout) {
				this.scopeEdgeGeometry(
					p.node.innerLayout,
					p.x + offsetX + COMPOUND_SIDE_PAD,
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					out,
				);
			}
		}

		// Edges in this scope. Phantoms are rank-only and skipped. Fan-out/
		// fan-in X's come from the top-level precomputed lane maps so they're
		// consistent with the cross-scope paths.
		for (const e of layout.edges) {
			if (e.phantom) continue;
			if (out.has(e.original)) continue;
			const fromP = layout.placements.get(e.from);
			const toP = layout.placements.get(e.to);
			if (!fromP || !toP) continue;
			const sx = this.fanOutX.get(e.original) ?? fromP.cx + offsetX;
			const sy = fromP.y + offsetY + fromP.node.height;
			const ex = this.fanInX.get(e.original) ?? toP.cx + offsetX;
			const ey = toP.y + offsetY;
			out.set(
				e.original,
				this.routeAround(
					lPath(sx, sy, ex, ey, (sy + ey) / 2),
					e.original,
					(sy + ey) / 2,
				),
			);
		}
	}

	private crossScopeEdgeGeometry(out: Map<ClassRelationship, Pt[]>): void {
		for (const r of this.crossScopeEdges) {
			const fromP = this.findPlacement(this.layout, r.from, 0, 0);
			const toP = this.findPlacement(this.layout, r.to, 0, 0);
			if (!fromP || !toP) continue;
			const sx = this.fanOutX.get(r) ?? fromP.cx;
			const sy = fromP.y + fromP.node.height;
			const ex = this.fanInX.get(r) ?? toP.cx;
			const ey = toP.y;
			// Clamp the horizontal jog into the gap between the source's
			// enclosing namespace bottom and the target's enclosing namespace
			// top — so the cross-namespace line never grazes (or routes
			// through) an unrelated class.
			let minJogY = sy + 16;
			const sourceScope = this.containing.get(r.from);
			if (sourceScope && sourceScope !== ROOT_SCOPE) {
				const compoundP = this.findPlacement(this.layout, sourceScope, 0, 0);
				if (compoundP) {
					minJogY = Math.max(
						minJogY,
						compoundP.y + compoundP.node.height + EDGE_CLEARANCE,
					);
				}
			}
			// Reserve `LABEL_RESERVE` px below the jog for the edge label
			// (`jogY + 16` baseline + a bit of breathing room) so labels never
			// land on the destination namespace's dark header strip.
			const LABEL_RESERVE = 20;
			let maxJogY = ey - 16;
			const targetScope = this.containing.get(r.to);
			if (targetScope && targetScope !== ROOT_SCOPE) {
				const compoundP = this.findPlacement(this.layout, targetScope, 0, 0);
				if (compoundP) {
					maxJogY = Math.min(
						maxJogY,
						compoundP.y - EDGE_CLEARANCE - (r.label ? LABEL_RESERVE : 0),
					);
				}
			}
			const preferredJogY = ey - 28;
			const jogY = Math.max(minJogY, Math.min(maxJogY, preferredJogY));
			out.set(r, this.routeAround(lPath(sx, sy, ex, ey, jogY), r, jogY));
		}
	}

	/** Boxes a segment cuts through, other than the edge's own ends and
	 * the namespaces they sit in. */
	private blockers(a: Pt, b: Pt, r: ClassRelationship): Obstacle[] {
		return this.obstacles.filter(
			(o) =>
				o.id !== r.from &&
				o.id !== r.to &&
				!(o.id.endsWith("#frame") && this.enclosesAnEnd(o.id, r)) &&
				segmentIntersectsRect(a, b, inflate(o.rect, 3)),
		);
	}

	/** Does the namespace behind a `#frame` obstacle contain either end of
	 * the relationship, at any depth? */
	private enclosesAnEnd(frameId: string, r: ClassRelationship): boolean {
		const ns = frameId.slice(0, -"#frame".length);
		const inside = (id: string) => {
			let scope = this.containing.get(id);
			while (scope && scope !== ROOT_SCOPE) {
				if (scope === ns) return true;
				scope = this.containing.get(scope);
			}
			return false;
		};
		return inside(r.from) || inside(r.to);
	}

	/** Detour a path's first and last verticals around whatever they would
	 * cut through: the descent into a target inside a namespace may cross a
	 * class ranked above it, or the namespace's label. The vertical moves to
	 * a corridor beside the obstacle, the nearest clear one; when the
	 * corridor is within the end box's width the edge lands there, otherwise
	 * a second jog just above the target (or below the source) brings it
	 * back to its lane. A path nothing blocks comes back unchanged. */
	private routeAround(pts: Pt[], r: ClassRelationship, jogY: number): Pt[] {
		let p = pts;
		const first = p[0] as Pt;
		const last = p[p.length - 1] as Pt;
		if (p.length === 2 && this.blockers(first, last, r).length > 0) {
			p = lPath(first.x, first.y, last.x, last.y, jogY, true);
		}
		if (p.length < 4) return p;

		// Target side: the final descent.
		{
			const n = p.length;
			const a = p[n - 2] as Pt;
			const b = p[n - 1] as Pt;
			const hit = this.blockers(a, b, r);
			const target = this.findPlacement(this.layout, r.to, 0, 0);
			if (hit.length > 0 && target) {
				for (const cx of corridorCandidates(hit, a.x)) {
					// Land where the target is nearest the corridor, so the
					// way back in is as short as it can be.
					const landX = clamp(
						cx,
						target.x + 10,
						target.x + target.node.width - 10,
					);
					const inside = landX === cx;
					const y2 = inside ? b.y : b.y - DETOUR_JOG;
					if (this.blockers({ x: cx, y: a.y }, { x: cx, y: y2 }, r).length)
						continue;
					if (this.blockers(p[n - 3] as Pt, { x: cx, y: a.y }, r).length)
						continue;
					if (
						!inside &&
						this.blockers({ x: cx, y: y2 }, { x: landX, y: y2 }, r).length
					)
						continue;
					p = inside
						? [...p.slice(0, n - 2), { x: cx, y: a.y }, { x: cx, y: b.y }]
						: [
								...p.slice(0, n - 2),
								{ x: cx, y: a.y },
								{ x: cx, y: y2 },
								{ x: landX, y: y2 },
								{ x: landX, y: b.y },
							];
					break;
				}
			}
		}

		// Source side: the first descent.
		{
			const a = p[0] as Pt;
			const b = p[1] as Pt;
			const hit = this.blockers(a, b, r);
			const source = this.findPlacement(this.layout, r.from, 0, 0);
			if (hit.length > 0 && source) {
				for (const cx of corridorCandidates(hit, b.x)) {
					const leaveX = clamp(
						cx,
						source.x + 10,
						source.x + source.node.width - 10,
					);
					const inside = leaveX === cx;
					const y1 = inside ? a.y : a.y + DETOUR_JOG;
					if (this.blockers({ x: cx, y: y1 }, { x: cx, y: b.y }, r).length)
						continue;
					if (this.blockers({ x: cx, y: b.y }, p[2] as Pt, r).length) continue;
					if (
						!inside &&
						this.blockers({ x: leaveX, y: y1 }, { x: cx, y: y1 }, r).length
					)
						continue;
					p = inside
						? [{ x: cx, y: a.y }, { x: cx, y: b.y }, ...p.slice(2)]
						: [
								{ x: leaveX, y: a.y },
								{ x: leaveX, y: y1 },
								{ x: cx, y: y1 },
								{ x: cx, y: b.y },
								...p.slice(2),
							];
					break;
				}
			}
		}
		return p;
	}

	// ─── Class-box rendering ─────────────────────────────────────────────────

	private renderClassBox(p: Placement, cls: ClassNode, out: string[]): void {
		const { x, y } = p;
		const w = p.node.width;
		const h = p.node.height;
		const stereotypeH = cls.stereotype ? CLASS_STEREOTYPE_HEIGHT : 0;
		const headerH = CLASS_HEADER_HEIGHT + stereotypeH;
		// Outer rect.
		out.push(
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ry="6" fill="${COLOR_NODE_FILL}" stroke="${COLOR_NODE_STROKE}" stroke-width="${STROKE_BOLD}"/>`,
		);
		// Header strip (rounded top, straight bottom).
		out.push(
			`<path d="M ${x} ${y + 6} a 6 6 0 0 1 6 -6 h ${w - 12} a 6 6 0 0 1 6 6 v ${headerH - 6} h -${w} z" fill="${COLOR_COMPOUND_HEADER_FILL}"/>`,
		);
		let titleBaselineY = y + headerH / 2 + 4;
		if (cls.stereotype) {
			out.push(
				`<text x="${x + w / 2}" y="${y + CLASS_STEREOTYPE_HEIGHT - 2}" text-anchor="middle" font-size="${FONT_SIZE_LABEL}" fill="white" opacity="0.75">${svgEsc(`«${cls.stereotype}»`)}</text>`,
			);
			titleBaselineY = y + stereotypeH + CLASS_HEADER_HEIGHT / 2 + 4;
		}
		out.push(
			`<text x="${x + w / 2}" y="${titleBaselineY}" text-anchor="middle" font-weight="600" fill="white">${svgEsc(displayClassTitle(cls))}</text>`,
		);

		let rowY = y + headerH + CLASS_DIVIDER_PAD + CLASS_ROW_HEIGHT - 4;
		for (const m of cls.members) {
			const text = visibilityChar(m) + displayMemberText(m.text);
			out.push(
				`<text x="${x + CLASS_SIDE_PAD}" y="${rowY}" font-size="${FONT_SIZE_LABEL}" fill="${COLOR_NODE_STROKE}">${svgEsc(text)}</text>`,
			);
			rowY += CLASS_ROW_HEIGHT + CLASS_ROW_GAP;
		}
	}

	// ─── Edge drawing primitive ──────────────────────────────────────────────

	private renderEdge(
		orig: ClassRelationship,
		path: EdgePath,
		out: string[],
	): void {
		const pts = path.pts;
		const first = pts[0];
		const last = pts[pts.length - 1];
		if (!first || !last) return;
		const sx = first.x;
		const sy = first.y;
		const ex = last.x;
		const ey = last.y;
		const kind = orig.kind;
		const dashed =
			kind === "dependency" || kind === "realization" || kind === "link";
		const dashAttr = dashed ? ' stroke-dasharray="4,3"' : "";
		// A composition or aggregation diamond sits on the whole, the
		// source; every other marker is an arrowhead on the target.
		const markerId = endMarker(kind);
		const markerAttr = markerId
			? isDiamond(kind)
				? ` marker-start="url(#${markerId})"`
				: ` marker-end="url(#${markerId})"`
			: "";
		const stroke = COLOR_EDGE;

		if (pts.length === 2) {
			out.push(
				`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="1.2"${dashAttr}${markerAttr}/>`,
			);
		} else {
			out.push(
				`<path d="${roundedPath(pts, 6)}" fill="none" stroke="${stroke}" stroke-width="1.2"${dashAttr}${markerAttr}/>`,
			);
		}

		for (const d of this.decorations.get(orig) ?? [])
			out.push(edgeLabel(d.x, d.y, d.text, d.anchor));
	}

	/** Where every edge's label and cardinalities go. Each has a list of
	 * places it could sit, best first; the first that lands on no box, no
	 * placed text, and no other edge's line wins, and the first candidate
	 * is the fallback. Cardinalities go first, since they have the least
	 * room to move. */
	private placeDecorations(): Map<ClassRelationship, EdgeDecoration[]> {
		const out = new Map<ClassRelationship, EdgeDecoration[]>();
		const placed: Rect[] = [];
		const free = (rect: Rect, own: ClassRelationship): boolean => {
			const r = inflate(rect, 2);
			if (
				this.obstacles.some(
					(o) => !o.id.endsWith("#frame") && rectsOverlap(r, o.rect),
				)
			)
				return false;
			if (placed.some((p) => rectsOverlap(r, p))) return false;
			for (const [other, path] of this.edgeGeoms) {
				if (other === own) continue;
				for (let i = 1; i < path.pts.length; i++) {
					if (
						segmentIntersectsRect(path.pts[i - 1] as Pt, path.pts[i] as Pt, r)
					)
						return false;
				}
			}
			return true;
		};
		const choose = (
			own: ClassRelationship,
			candidates: EdgeDecoration[],
		): EdgeDecoration | undefined => {
			const first = candidates[0];
			if (!first) return undefined;
			const pick =
				candidates.find((c) =>
					free(labelRect(c.text, c.x, c.y, c.anchor), own),
				) ?? first;
			placed.push(labelRect(pick.text, pick.x, pick.y, pick.anchor));
			return pick;
		};
		const around = (text: string, p: Pt, below: boolean): EdgeDecoration[] => {
			const near = below ? 14 : -6;
			const far = below ? -6 : 14;
			return [
				{ x: p.x + 8, y: p.y + near, text, anchor: "start" },
				{ x: p.x - 8, y: p.y + near, text, anchor: "end" },
				{ x: p.x + 8, y: p.y + far, text, anchor: "start" },
				{ x: p.x - 8, y: p.y + far, text, anchor: "end" },
			];
		};
		for (const [r, path] of this.edgeGeoms) {
			const list: EdgeDecoration[] = [];
			const first = path.pts[0] as Pt;
			const last = path.pts[path.pts.length - 1] as Pt;
			if (r.fromCardinality) {
				const d = choose(r, around(r.fromCardinality, first, true));
				if (d) list.push(d);
			}
			if (r.toCardinality) {
				const d = choose(r, around(r.toCardinality, last, false));
				if (d) list.push(d);
			}
			if (r.label) {
				const d = choose(r, this.labelCandidates(r.label, path));
				if (d) list.push(d);
			}
			out.set(r, list);
		}
		return out;
	}

	/** Where a label could sit, best first. On a forward edge: beside the
	 * descent after the first turn on the side facing the source, as in
	 * the flowchart, then the other side, lower, beside the final descent,
	 * and over the first horizontal run. On a straight drop: beside the
	 * midpoint. On a back edge: beside the channel at a few heights. On a
	 * self loop: right of the loop. */
	private labelCandidates(text: string, path: EdgePath): EdgeDecoration[] {
		const pts = path.pts;
		const out: EdgeDecoration[] = [];
		const beside = (x: number, y: number, side: 1 | -1) =>
			out.push(
				side > 0
					? { x: x + 6, y, text, anchor: "start" }
					: { x: x - 6, y, text, anchor: "end" },
			);
		if (path.kind === "self") {
			const edge = pts[0] as Pt;
			const reach = pts[1] as Pt;
			const side: 1 | -1 = reach.x > edge.x ? 1 : -1;
			beside(reach.x, reach.y + 12, side);
			// Below the loop, then above it, hugging the node.
			beside(edge.x - side * 4, reach.y + 16 + 14, side);
			beside(edge.x - side * 4, reach.y - 6, side);
			return out;
		}
		if (path.kind === "back" && path.channelX !== undefined) {
			const ys = pts.filter((p) => p.x === path.channelX).map((p) => p.y);
			const top = Math.min(...ys);
			const bottom = Math.max(...ys);
			const lx = path.labelX ?? path.channelX;
			for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
				beside(lx, top + (bottom - top) * t + 4, 1);
			}
			return out;
		}
		if (pts.length === 2) {
			const a = pts[0] as Pt;
			const b = pts[1] as Pt;
			const midY = (a.y + b.y) / 2 + 4;
			beside(a.x, midY, 1);
			beside(a.x, midY, -1);
			beside(a.x, midY - 20, 1);
			beside(a.x, midY + 20, 1);
			return out;
		}
		const turn = pts[2] as Pt;
		const across = turn.x - (pts[1] as Pt).x;
		const descentEnd = pts[3] as Pt;
		const facing: 1 | -1 = across > 0 ? -1 : 1;
		const other: 1 | -1 = facing > 0 ? -1 : 1;
		const y1 = Math.min(turn.y + 16, descentEnd.y - 6);
		beside(turn.x, y1, facing);
		beside(turn.x, y1, other);
		if (descentEnd.y - turn.y > 44) {
			beside(turn.x, turn.y + 30, facing);
			beside(turn.x, turn.y + 30, other);
		}
		const n = pts.length;
		if (n > 4) {
			const d = pts[n - 2] as Pt;
			const e = pts[n - 1] as Pt;
			const y = Math.min(d.y + 16, e.y - 6);
			beside(d.x, y, facing);
			beside(d.x, y, other);
		}
		const start = pts[0] as Pt;
		if ((pts[1] as Pt).y - start.y > 24) {
			beside(start.x, start.y + 16, facing);
			beside(start.x, start.y + 16, other);
		}
		const run = pts[1] as Pt;
		if (Math.abs(across) > estimateTextWidth(text, FONT_SIZE_LABEL) + 12) {
			out.push({
				x: (run.x + turn.x) / 2,
				y: run.y - 4,
				text,
				anchor: "middle",
			});
		}
		return out;
	}

	/** The drawing as geometry, for the overlap check. */
	diagnostics(): RenderDiagnostics {
		const key = (r: ClassRelationship) =>
			`${r.from} ${arrowForKind(r.kind)} ${r.to}`;
		const d: RenderDiagnostics = {
			boxes: [],
			segments: [],
			labels: [],
			markers: [],
		};
		for (const o of this.obstacles)
			d.boxes.push({
				id: o.id,
				rect: o.rect,
				solid: !o.id.endsWith("#frame"),
			});
		for (const [i, np] of this.notePlacements.entries()) {
			d.boxes.push({
				id: `note ${i + 1}`,
				rect: { x: np.x, y: np.y, w: np.width, h: np.height },
				solid: true,
			});
		}
		for (const [r, { pts }] of this.edgeGeoms) {
			const k = key(r);
			for (let i = 1; i < pts.length; i++) {
				d.segments.push({
					edge: k,
					ends: [r.from, r.to],
					a: pts[i - 1] as Pt,
					b: pts[i] as Pt,
				});
			}
			for (const dec of this.decorations.get(r) ?? []) {
				d.labels.push({
					text: dec.text,
					rect: labelRect(dec.text, dec.x, dec.y, dec.anchor),
					edge: k,
				});
			}
			if (endMarker(r.kind)) {
				const m = isDiamond(r.kind) ? pts[0] : pts[pts.length - 1];
				if (m) d.markers.push({ edge: k, x: m.x, y: m.y });
			}
		}
		return d;
	}

	// ─── Note rendering ──────────────────────────────────────────────────────

	private renderNotes(out: string[]): void {
		// Collect occupied rectangles once so we can route the leader so it
		// doesn't cross any class or namespace box. Each note adds its own
		// rect so subsequent leaders also avoid earlier notes.
		const boxes: Rect[] = [];
		for (const p of this.layout.placements.values()) {
			if (p.node.kind !== "class" && p.node.kind !== "namespace") continue;
			boxes.push({
				x: p.x,
				y: p.y,
				w: p.node.width,
				h: p.node.height,
			});
		}
		for (const np of this.notePlacements) {
			out.push(
				renderStickyNote({
					x: np.x,
					y: np.y,
					width: np.width,
					height: np.height,
					text: "",
				}),
			);
			let lineY = np.y + NOTE_PADDING + NOTE_LINE_HEIGHT - 4;
			if (np.note.target) {
				out.push(
					`<text x="${np.x + NOTE_PADDING}" y="${lineY}" font-size="${FONT_SIZE_LABEL}" font-weight="600" fill="${COLOR_EDGE}">${svgEsc(np.note.target)}</text>`,
				);
				lineY += NOTE_LINE_HEIGHT;
			}
			for (const ln of np.bodyLines) {
				out.push(
					`<text x="${np.x + NOTE_PADDING}" y="${lineY}" font-size="${FONT_SIZE_LABEL}" fill="${COLOR_EDGE}">${svgEsc(ln)}</text>`,
				);
				lineY += NOTE_LINE_HEIGHT;
			}
			if (np.note.target) {
				this.renderNoteLeader(np, boxes, out);
			}
			boxes.push({ x: np.x, y: np.y, w: np.width, h: np.height });
		}
	}

	/** Dashed leader from the note to its target class. The leader is drawn
	 * as a straight line between the nearest edges; if that segment would
	 * cross any box (other than the target itself), it's skipped — the note
	 * still renders, just without the connecting line, rather than visually
	 * cutting through unrelated classes. */
	private renderNoteLeader(
		np: NotePlacement,
		boxes: ReadonlyArray<Rect>,
		out: string[],
	): void {
		const target = np.note.target;
		if (!target) return;
		const targetP = this.findPlacement(this.layout, target, 0, 0);
		if (!targetP) return;
		const targetRect: Rect = {
			x: targetP.x,
			y: targetP.y,
			w: targetP.node.width,
			h: targetP.node.height,
		};
		const ends = nearestEdges(
			{ x: np.x, y: np.y, w: np.width, h: np.height },
			targetRect,
		);
		// Skip if the leader segment would pass through any box other than
		// the target and the namespace around it. Note rects themselves are
		// already in `boxes`.
		const scopeRect = this.outerBoxFor(target);
		for (const b of boxes) {
			if (rectsAreSame(b, targetRect)) continue;
			if (scopeRect && rectsAreSame(b, scopeRect)) continue;
			if (segmentIntersectsRect(ends.start, ends.end, b)) return;
		}
		out.push(
			`<line x1="${ends.start.x}" y1="${ends.start.y}" x2="${ends.end.x}" y2="${ends.end.y}" stroke="${COLOR_EDGE}" stroke-width="1" stroke-dasharray="2,3"/>`,
		);
	}
}

// ─── Standalone helpers ──────────────────────────────────────────────────────

function classWidth(cls: ClassNode): number {
	const titleText = displayClassTitle(cls);
	const titleW = Math.ceil(estimateTextWidth(titleText));
	const stereotypeW = cls.stereotype
		? Math.ceil(estimateTextWidth(`«${cls.stereotype}»`, FONT_SIZE_LABEL))
		: 0;
	let memberW = 0;
	for (const m of cls.members) {
		const w = Math.ceil(
			estimateTextWidth(
				`${visibilityChar(m)}${displayMemberText(m.text)}`,
				FONT_SIZE_LABEL,
			),
		);
		if (w > memberW) memberW = w;
	}
	return Math.max(
		CLASS_MIN_WIDTH,
		titleW + CLASS_SIDE_PAD * 2,
		stereotypeW + CLASS_SIDE_PAD * 2,
		memberW + CLASS_SIDE_PAD * 2,
	);
}

function classHeight(cls: ClassNode): number {
	const rows = cls.members.length;
	const headerH =
		CLASS_HEADER_HEIGHT + (cls.stereotype ? CLASS_STEREOTYPE_HEIGHT : 0);
	if (rows === 0) return headerH + 4;
	return (
		headerH +
		CLASS_DIVIDER_PAD +
		rows * (CLASS_ROW_HEIGHT + CLASS_ROW_GAP) +
		CLASS_DIVIDER_PAD
	);
}

function displayClassTitle(cls: ClassNode): string {
	const base = cls.label ?? cls.id;
	return cls.typeParam ? `${base}<${cls.typeParam}>` : base;
}

function displayMemberText(text: string): string {
	let out = text;
	let prev = "";
	while (prev !== out) {
		prev = out;
		out = out.replace(/~([^~<>]+)~/g, "<$1>");
	}
	return out;
}

function wrapNoteText(text: string, maxWidth: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (estimateTextWidth(next, FONT_SIZE_LABEL) <= maxWidth) {
			current = next;
		} else {
			if (current) lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines.length === 0 ? [text] : lines;
}

function visibilityChar(m: ClassMember): string {
	switch (m.visibility) {
		case "public":
			return "+";
		case "private":
			return "-";
		case "protected":
			return "#";
		case "package":
			return "~";
		case "none":
			return "";
	}
}

function endMarker(kind: ClassRelationshipKind): string | undefined {
	switch (kind) {
		case "inheritance":
		case "realization":
			return MARKER_IDS.triangle;
		case "composition":
			return MARKER_IDS.diamondFilled;
		case "aggregation":
			return MARKER_IDS.diamondHollow;
		case "association":
		case "dependency":
			return MARKER_IDS.arrow;
		case "association-und":
		case "link":
			return undefined;
	}
}

function formatRelationship(r: ClassRelationship): string {
	const arrow = arrowForKind(r.kind);
	const left = r.fromCardinality ? `${r.from} "${r.fromCardinality}"` : r.from;
	const right = r.toCardinality ? `"${r.toCardinality}" ${r.to}` : r.to;
	const label = r.label ? ` : ${r.label}` : "";
	return `${left} ${arrow} ${right}${label}`;
}

function arrowForKind(k: ClassRelationshipKind): string {
	switch (k) {
		case "inheritance":
			return "--|>";
		case "realization":
			return "..|>";
		case "composition":
			return "*--";
		case "aggregation":
			return "o--";
		case "association":
			return "-->";
		case "association-und":
			return "--";
		case "dependency":
			return "..>";
		case "link":
			return "..";
	}
}

function markerTriangle(id: string): string {
	return `<marker id="${id}" markerWidth="14" markerHeight="14" refX="14" refY="7" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 14 7 L 0 14 z" fill="white" stroke="${COLOR_EDGE}" stroke-width="1.2"/></marker>`;
}

/** A diamond for the start of a path: its near tip at the path's first
 * point, the rest along the line. */
function markerDiamond(id: string, fill: string): string {
	return `<marker id="${id}" markerWidth="16" markerHeight="10" refX="0" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 5 L 8 0 L 16 5 L 8 10 z" fill="${fill}" stroke="${COLOR_EDGE}" stroke-width="1.2"/></marker>`;
}

function isDiamond(kind: ClassRelationshipKind): boolean {
	return kind === "composition" || kind === "aggregation";
}

/** Source bottom to target top: a straight drop when they share an x,
 * otherwise down, across at `jogY`, down. `forceJog` makes the four-point
 * form even for a shared x, so a detour has a horizontal to extend. */
function lPath(
	sx: number,
	sy: number,
	ex: number,
	ey: number,
	jogY: number,
	forceJog = false,
): Pt[] {
	if (!forceJog && Math.abs(sx - ex) < 1) {
		return [
			{ x: sx, y: sy },
			{ x: ex, y: ey },
		];
	}
	return [
		{ x: sx, y: sy },
		{ x: sx, y: jogY },
		{ x: ex, y: jogY },
		{ x: ex, y: ey },
	];
}

/** Corridor x positions beside each obstacle, nearest to `x` first; a tie
 * goes left. */
function corridorCandidates(hit: Obstacle[], x: number): number[] {
	const out: number[] = [];
	for (const o of hit) {
		out.push(o.rect.x - EDGE_CLEARANCE, o.rect.x + o.rect.w + EDGE_CLEARANCE);
	}
	return out.sort((a, b) => Math.abs(a - x) - Math.abs(b - x) || a - b);
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function rectsAreSame(a: Rect, b: Rect): boolean {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rangesOverlap(
	a0: number,
	a1: number,
	b0: number,
	b1: number,
): boolean {
	return a0 < b1 && b0 < a1;
}

function overlapsAny(rect: Rect, others: ReadonlyArray<Rect>): boolean {
	for (const o of others) {
		if (
			rect.x < o.x + o.w &&
			rect.x + rect.w > o.x &&
			rect.y < o.y + o.h &&
			rect.y + rect.h > o.y
		) {
			return true;
		}
	}
	return false;
}

/** Nearest-edge connection points between two non-overlapping rects. The
 * returned `start`/`end` sit on the rect borders, picked along the axis
 * with the largest separation so the connecting line is mostly straight. */
function nearestEdges(
	a: Rect,
	b: Rect,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
	const aRight = a.x + a.w;
	const aBottom = a.y + a.h;
	const bRight = b.x + b.w;
	const bBottom = b.y + b.h;
	const aCx = a.x + a.w / 2;
	const aCy = a.y + a.h / 2;
	const bCx = b.x + b.w / 2;
	const bCy = b.y + b.h / 2;
	const dx = bCx - aCx;
	const dy = bCy - aCy;
	if (Math.abs(dx) >= Math.abs(dy)) {
		// Connect on left/right edges.
		if (dx > 0) {
			return {
				start: { x: aRight, y: clamp(bCy, a.y, aBottom) },
				end: { x: b.x, y: clamp(aCy, b.y, bBottom) },
			};
		}
		return {
			start: { x: a.x, y: clamp(bCy, a.y, aBottom) },
			end: { x: bRight, y: clamp(aCy, b.y, bBottom) },
		};
	}
	// Connect on top/bottom edges.
	if (dy > 0) {
		return {
			start: { x: clamp(bCx, a.x, aRight), y: aBottom },
			end: { x: clamp(aCx, b.x, bRight), y: b.y },
		};
	}
	return {
		start: { x: clamp(bCx, a.x, aRight), y: a.y },
		end: { x: clamp(aCx, b.x, bRight), y: bBottom },
	};
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}
