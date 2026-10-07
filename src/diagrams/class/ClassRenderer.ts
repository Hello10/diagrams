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
	width: number;
	height: number;
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

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

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
		this.notePlacements = this.layoutNotes();
		// Canvas takes the larger of the class layout's footprint and the
		// notes band that sits beneath it.
		const notesBottom = this.notePlacements.reduce(
			(acc, n) => Math.max(acc, n.y + n.height),
			0,
		);
		this.width =
			Math.max(this.layout.width, this.maxNoteRowWidth()) + PADDING_OUTER * 2;
		this.height = notesBottom + this.topOffset() + PADDING_OUTER;
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
		// rectangle (namespaces cover their inner classes already). Notes are
		// added as they're placed so subsequent notes can't overlap earlier
		// ones.
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

		for (const note of this.ast.notes) {
			const lines = wrapNoteText(note.text, NOTE_WIDTH - NOTE_PADDING * 2);
			const h = lines.length * NOTE_LINE_HEIGHT + NOTE_PADDING * 2;
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
		this.renderEdgesRecursive(this.layout, 0, 0, inner);
		this.renderCrossScopeEdges(inner);
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
			layoutNodes.push({
				id: c.id,
				kind: "class",
				width: classWidth(c),
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

		return { placements, edges: internalEdges, width, height };
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

	private renderEdgesRecursive(
		layout: LayoutResult,
		offsetX: number,
		offsetY: number,
		out: string[],
	): void {
		// Recurse into compound children first so the inner edges paint
		// before their containing scope's edges.
		for (const p of layout.placements.values()) {
			if (p.node.kind === "namespace" && p.node.innerLayout) {
				this.renderEdgesRecursive(
					p.node.innerLayout,
					p.x + offsetX + COMPOUND_SIDE_PAD,
					p.y + offsetY + COMPOUND_HEADER + COMPOUND_TOP_INNER_PAD,
					out,
				);
			}
		}

		// Edges in this scope. Phantoms are rank-only and skipped. Fan-out/
		// fan-in X's come from the top-level precomputed lane maps so they're
		// consistent with the cross-scope renderer.
		const seen = new Set<ClassRelationship>();
		for (const e of layout.edges) {
			if (e.phantom) continue;
			if (seen.has(e.original)) continue;
			seen.add(e.original);
			const fromP = layout.placements.get(e.from);
			const toP = layout.placements.get(e.to);
			if (!fromP || !toP) continue;
			this.renderEdge(
				e.original,
				{
					sx: this.fanOutX.get(e.original) ?? fromP.cx + offsetX,
					sy: fromP.y + offsetY + fromP.node.height,
					ex: this.fanInX.get(e.original) ?? toP.cx + offsetX,
					ey: toP.y + offsetY,
				},
				out,
			);
		}
	}

	private renderCrossScopeEdges(out: string[]): void {
		const CLEARANCE = 12;
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
						compoundP.y + compoundP.node.height + CLEARANCE,
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
						compoundP.y - CLEARANCE - (r.label ? LABEL_RESERVE : 0),
					);
				}
			}
			const preferredJogY = ey - 28;
			const jogY = Math.max(minJogY, Math.min(maxJogY, preferredJogY));
			this.renderEdge(r, { sx, sy, ex, ey, jogY }, out);
		}
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
		geom: {
			sx: number;
			sy: number;
			ex: number;
			ey: number;
			/** Y position of the horizontal jog for L-shape paths. Default is
			 * the midpoint; cross-scope edges override it to clear compound
			 * boundaries. */
			jogY?: number;
		},
		out: string[],
	): void {
		const { sx, sy, ex, ey } = geom;
		const kind = orig.kind;
		const dashed =
			kind === "dependency" || kind === "realization" || kind === "link";
		const dashAttr = dashed ? ' stroke-dasharray="4,3"' : "";
		const targetMarkerId = endMarker(kind);
		const markerAttr = targetMarkerId
			? ` marker-end="url(#${targetMarkerId})"`
			: "";
		const stroke = COLOR_EDGE;

		const isStraightVertical = Math.abs(sx - ex) < 1;
		const jogY = geom.jogY ?? (sy + ey) / 2;

		if (isStraightVertical) {
			out.push(
				`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="1.2"${dashAttr}${markerAttr}/>`,
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
				`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.2"${dashAttr}${markerAttr}/>`,
			);
		}

		// Cardinalities sit just outside each class box on the side opposite
		// to where the line turns, so they don't pile on top of the
		// relationship label.
		if (orig.fromCardinality) {
			out.push(edgeLabel(sx + 6, sy + 14, orig.fromCardinality));
		}
		if (orig.toCardinality) {
			out.push(edgeLabel(ex + 6, ey - 6, orig.toCardinality));
		}
		// Edge label rides on the descending segment near the top of the
		// drop, source-facing side of the turn — same convention as
		// flowchart. For straight verticals the label sits at the midpoint.
		if (orig.label) {
			if (isStraightVertical) {
				const midY = (sy + ey) / 2;
				out.push(edgeLabel(sx + 6, midY + 4, orig.label));
			} else {
				const labelY = jogY + 16;
				const dir = ex > sx ? 1 : -1;
				if (dir > 0) {
					out.push(edgeLabel(ex - 6, labelY, orig.label, "end"));
				} else {
					out.push(edgeLabel(ex + 6, labelY, orig.label));
				}
			}
		}
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
		// the target. Note rects themselves are already in `boxes`.
		for (const b of boxes) {
			if (rectsAreSame(b, targetRect)) continue;
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
			return "<|--";
		case "realization":
			return "<|..";
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

function markerDiamond(id: string, fill: string): string {
	return `<marker id="${id}" markerWidth="16" markerHeight="10" refX="16" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 5 L 8 0 L 16 5 L 8 10 z" fill="${fill}" stroke="${COLOR_EDGE}" stroke-width="1.2"/></marker>`;
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

/** Liang–Barsky-style segment vs axis-aligned-rect intersection. Returns
 * true if the open segment passes through any interior point of the rect. */
function segmentIntersectsRect(
	p: { x: number; y: number },
	q: { x: number; y: number },
	rect: Rect,
): boolean {
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	let tEnter = 0;
	let tExit = 1;
	const slabs: Array<[number, number, number]> = [
		[-dx, p.x - rect.x, 0],
		[dx, rect.x + rect.w - p.x, 0],
		[-dy, p.y - rect.y, 0],
		[dy, rect.y + rect.h - p.y, 0],
	];
	for (const [pi, qi] of slabs) {
		if (pi === 0) {
			if (qi < 0) return false;
		} else {
			const t = qi / pi;
			if (pi < 0) {
				if (t > tExit) return false;
				if (t > tEnter) tEnter = t;
			} else {
				if (t < tEnter) return false;
				if (t < tExit) tExit = t;
			}
		}
	}
	// Treat touching the boundary as "not crossing" — leader endpoints on
	// the target's edge shouldn't count as an intersection with the
	// target rect.
	return tEnter < tExit && tExit > 0 && tEnter < 1;
}
