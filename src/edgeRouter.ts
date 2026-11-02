import { computeFanLanes } from "./edges.ts";
import { FONT_SIZE_LABEL } from "./style.ts";
import { estimateTextWidth } from "./svg.ts";

/**
 * Shared edge routing for every layered graph: state diagrams, flowcharts,
 * the UI flow. Given placed nodes and edges, it decides each edge's path
 * and where its label goes. Renderers keep their own styling (stroke,
 * dashes, arrowheads) and emit the geometry this returns.
 *
 * Routing, by edge kind:
 *   straight  source bottom to target top in one column
 *   jog       down, across in the rank gap, down; every segment in a gap
 *             gets its own jog line so horizontals never overlap
 *   chain     the same through the virtual nodes of a multi-rank edge
 *   twin      both directions between one pair: two arcs bowing apart
 *   back      up a channel to the right of the graph, into the target
 *   self      a loop on the right of the node
 *
 * Labels are placed last, from a list of candidates per kind, taking the
 * first that collides with no node, no placed label, and no other path.
 */

export interface RoutePlacement {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	cx: number;
	cy: number;
	/** Virtual nodes are chain waypoints: no box, nothing to avoid. */
	virtual?: boolean;
}

export interface RouteEdge {
	/** Stable key the renderer uses to find its edge in the result. */
	key: string;
	from: string;
	to: string;
	label?: string;
	isBack: boolean;
	/** `[from, …virtual ids…, to]` for edges spanning several ranks. */
	chain?: string[];
}

export type RouteKind = "straight" | "jog" | "chain" | "twin" | "back" | "self";

export interface RoutedLabel {
	x: number;
	y: number;
	text: string;
	anchor: "start" | "middle" | "end";
}

export interface RoutedEdge {
	key: string;
	kind: RouteKind;
	/** SVG path data. */
	d: string;
	label?: RoutedLabel;
}

export interface RouteResult {
	edges: RoutedEdge[];
	/** Everything drawn, labels included. Negative x1/y1 means the routes
	 * spill past the nodes; the caller shifts or pads accordingly. */
	bounds: { x1: number; y1: number; x2: number; y2: number };
}

export interface RouteOptions {
	/** Where an edge meets a node. Default: bottom centre leaving, top centre
	 * entering, at the fan lane's x. Diagram shapes (diamonds, cylinders)
	 * project onto their outline here. */
	anchor?: (
		node: RoutePlacement,
		role: "source" | "target",
		aimX: number,
	) => { x: number; y: number };
	/** Corner radius on jogs. */
	radius?: number;
	/** How far twin arcs bow from the straight chord. */
	twinBow?: number;
	/** Gap between the graph's right edge and the first back-edge channel. */
	channelOffset?: number;
}

const DEFAULTS = { radius: 6, twinBow: 14, channelOffset: 28 } as const;
const LABEL_H = FONT_SIZE_LABEL + 4;
const LABEL_PAD = 6;
const JOG_STEP = 12;
const CHANNEL_STEP = 14;
const SELF_BULGE = 16;
const MIN_FAN_WIDTH = 48;

type Pt = { x: number; y: number };

/** One decimal, no float noise in path data. */
function n(v: number): string {
	return String(Math.round(v * 10) / 10);
}
type Box = { x1: number; y1: number; x2: number; y2: number };

export function routeEdges(
	placements: Map<string, RoutePlacement>,
	edges: RouteEdge[],
	options: RouteOptions = {},
): RouteResult {
	const r = options.radius ?? DEFAULTS.radius;
	const bow = options.twinBow ?? DEFAULTS.twinBow;
	const anchor =
		options.anchor ??
		((node: RoutePlacement, role: "source" | "target", aimX: number) =>
			role === "source"
				? { x: aimX, y: node.y + node.height }
				: { x: aimX, y: node.y });

	const live = edges.filter(
		(e) => placements.has(e.from) && placements.has(e.to),
	);

	// Twin pairs: both directions between one pair of nodes. Two edges the
	// same way are not twins; they fan from the node like any others.
	const directed = new Set<string>();
	for (const e of live) if (e.from !== e.to) directed.add(`${e.from}>${e.to}`);
	const bothWays = (a: string, b: string) =>
		directed.has(`${a}>${b}`) && directed.has(`${b}>${a}`);
	// Only pairs in one column draw as twin arcs; a diagonal pair is a
	// forward edge and a back edge like any other.
	const sameColumn = (a: string, b: string) => {
		const pa = placements.get(a);
		const pb = placements.get(b);
		return !!pa && !!pb && Math.abs(pa.cx - pb.cx) < 1;
	};
	const isTwin = (e: RouteEdge) =>
		e.from !== e.to && bothWays(e.from, e.to) && sameColumn(e.from, e.to);
	const isBack = (e: RouteEdge) => {
		if (e.from === e.to || isTwin(e)) return false;
		if (e.isBack) return true;
		const from = placements.get(e.from);
		const to = placements.get(e.to);
		return !!from && !!to && to.cy < from.cy;
	};

	// Fan lanes: where several forward edges share a node's bottom or top.
	const forward = live.filter(
		(e) => !isBack(e) && e.from !== e.to && !isTwin(e),
	);
	const laneAnchor = (id: string) => {
		const p = placements.get(id);
		if (!p) return undefined;
		if (p.virtual) return { x: p.cx, width: 0, cx: p.cx };
		if (p.width < MIN_FAN_WIDTH) return undefined;
		return { x: p.x, width: p.width, cx: p.cx };
	};
	// Twin arcs sit at a node's centre, so they take part in the lane
	// spacing (keeping forward edges clear of them) but keep their own x.
	const twinsDown = live.filter((e) => {
		if (!isTwin(e)) return false;
		const from = placements.get(e.from);
		const to = placements.get(e.to);
		return !!from && !!to && from.cy < to.cy;
	});
	const exitLanes = computeFanLanes<RouteEdge>({
		edges: [...forward, ...twinsDown],
		groupBy: (e) => e.from,
		anchor: laneAnchor,
		aimAt: (e) => placements.get(e.chain?.[1] ?? e.to)?.cx,
		minGap: 24,
	});
	const entryLanes = computeFanLanes<RouteEdge>({
		edges: [...forward, ...twinsDown],
		groupBy: (e) => e.to,
		anchor: laneAnchor,
		aimAt: (e) => {
			const chain = e.chain ?? [];
			return placements.get(
				chain.length > 2 ? (chain[chain.length - 2] ?? e.from) : e.from,
			)?.cx;
		},
		minGap: 24,
	});

	// Rank bands, from the placements themselves: nodes sharing a centre
	// line are a rank; the gap below rank i gets jog slots.
	const rows = rankRows(placements);
	const rankOf = new Map<string, number>();
	rows.forEach((row, i) => {
		for (const id of row.ids) rankOf.set(id, i);
	});
	const jogs = assignJogSlots(forward, placements, rows, rankOf);

	// Back-edge channels, one per back edge, right of everything.
	const boxes = [...placements.values()].filter((p) => !p.virtual);
	const rightEdge = Math.max(0, ...boxes.map((p) => p.x + p.width));
	const leftEdge = Math.min(0, ...boxes.map((p) => p.x));
	const channelOffset = options.channelOffset ?? DEFAULTS.channelOffset;
	const channels = { right: 0, left: 0 };

	const routed: RoutedEdge[] = [];
	const polylines = new Map<string, Pt[]>();
	const candidates = new Map<string, RoutedLabel[]>();

	// Back edges go last: their channels must clear the labels the other
	// edges put beside the graph.
	const ordered = [...live.filter((e) => !isBack(e)), ...live.filter(isBack)];
	let labelLeft = leftEdge;
	let labelRight = rightEdge;
	// Which candidate a label ends up at is settled only after routing, so
	// a channel clears every place the label might go.
	const widenToLabels = () => {
		for (const list of candidates.values()) {
			for (const candidate of list) {
				const box = labelBox(candidate);
				labelLeft = Math.min(labelLeft, box.x1);
				labelRight = Math.max(labelRight, box.x2);
			}
		}
	};
	let backStarted = false;

	for (const e of ordered) {
		const from = placements.get(e.from);
		const to = placements.get(e.to);
		if (!from || !to) continue;

		if (e.from === e.to) {
			const sx = from.x + from.width;
			const sy = from.cy - 4;
			const ey = from.cy + 4;
			routed.push({
				key: e.key,
				kind: "self",
				d: `M ${n(sx)} ${n(sy)} C ${n(sx + SELF_BULGE * 2)} ${n(sy - SELF_BULGE)} ${n(sx + SELF_BULGE * 2)} ${n(ey + SELF_BULGE)} ${n(sx)} ${n(ey)}`,
			});
			polylines.set(e.key, [
				{ x: sx, y: sy },
				{ x: sx + SELF_BULGE * 2, y: from.cy },
				{ x: sx, y: ey },
			]);
			if (e.label) {
				candidates.set(e.key, [
					{
						x: sx + SELF_BULGE * 2 + 6,
						y: from.cy + 4,
						text: e.label,
						anchor: "start",
					},
				]);
			}
			continue;
		}

		if (isTwin(e)) {
			const upper = from.cy < to.cy ? from : to;
			const lower = upper === from ? to : from;
			const goingDown = upper === from;
			const ax = upper.cx;
			const ay = upper.y + upper.height;
			const bx = lower.cx;
			const by = lower.y;
			const dx = bx - ax;
			const dy = by - ay;
			const len = Math.hypot(dx, dy) || 1;
			// Each arc bows to the left of its own direction of travel.
			const side = goingDown ? 1 : -1;
			const nx = (-dy / len) * side;
			const ny = (dx / len) * side;
			const mx = (ax + bx) / 2;
			const my = (ay + by) / 2;
			const cx = mx + nx * bow * 2;
			const cy = my + ny * bow * 2;
			const [sx, sy, ex, ey] = goingDown ? [ax, ay, bx, by] : [bx, by, ax, ay];
			routed.push({
				key: e.key,
				kind: "twin",
				d: `M ${n(sx)} ${n(sy)} Q ${n(cx)} ${n(cy)} ${n(ex)} ${n(ey)}`,
			});
			polylines.set(e.key, [
				{ x: sx, y: sy },
				{ x: mx + nx * bow, y: my + ny * bow },
				{ x: ex, y: ey },
			]);
			if (e.label) {
				// Along the arc's outer side first; the inner side, between
				// the twins, as a fallback when the outer side is in use.
				const list: RoutedLabel[] = [];
				for (const flip of [1, -1]) {
					const fx = nx * flip;
					const fy = ny * flip;
					for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
						const px = ax + dx * t;
						const py = ay + dy * t;
						const clearance = bow + 6 + Math.abs(fy) * 10;
						list.push({
							x: px + fx * clearance,
							y: py + fy * clearance + (fy > 0.3 ? 10 : fy < -0.3 ? -2 : 4),
							text: e.label,
							anchor: fx < -0.3 ? "end" : fx > 0.3 ? "start" : "middle",
						});
					}
				}
				candidates.set(e.key, list);
			}
			continue;
		}

		if (isBack(e)) {
			if (!backStarted) {
				widenToLabels();
				backStarted = true;
			}
			// Up a channel beside the graph. Prefer the right; take the left
			// when another node on the target's rank blocks the right; when
			// both sides are blocked, come up the right and enter from below.
			const rank = rankOf.get(to.id) ?? 0;
			const srcRank = rankOf.get(from.id) ?? 0;
			const beside = (
				node: RoutePlacement,
				r: number,
				side: "left" | "right",
			) =>
				(rows[r]?.ids ?? []).some((id) => {
					const p = placements.get(id);
					if (!p || p.virtual || p.id === node.id) return false;
					return side === "right"
						? p.x >= node.x + node.width
						: p.x + p.width <= node.x;
				});
			const side: "left" | "right" = !beside(to, rank, "right")
				? "right"
				: !beside(to, rank, "left")
					? "left"
					: "right";
			const apex =
				side === "right"
					? labelRight + channelOffset + channels.right * CHANNEL_STEP
					: labelLeft - channelOffset - channels.left * CHANNEL_STEP;
			channels[side]++;
			const pts: Pt[] = [];
			// Leave the source from the channel side when clear, else drop
			// into the gap below it first.
			if (!beside(from, srcRank, side)) {
				pts.push({
					x: side === "right" ? from.x + from.width : from.x,
					y: from.cy,
				});
			} else {
				const below = rows[srcRank]?.bottom ?? from.y + from.height;
				const gapY = below + 14 + channels[side] * 8;
				pts.push(
					{ x: from.cx, y: from.y + from.height },
					{ x: from.cx, y: gapY },
				);
			}
			pts.push({ x: apex, y: pts[pts.length - 1]?.y ?? from.cy });
			if (!beside(to, rank, side)) {
				pts.push(
					{ x: apex, y: to.cy },
					{ x: side === "right" ? to.x + to.width : to.x, y: to.cy },
				);
			} else {
				const gapY =
					(rows[rank]?.bottom ?? to.y + to.height) + 14 + channels[side] * 8;
				const ex = to.x + to.width * 0.75;
				pts.push(
					{ x: apex, y: gapY },
					{ x: ex, y: gapY },
					{ x: ex, y: to.y + to.height },
				);
			}
			routed.push({ key: e.key, kind: "back", d: roundedPath(pts, r) });
			polylines.set(e.key, pts);
			if (e.label) {
				// Beside the channel's vertical run, at several heights.
				const a = pts.find((p) => p.x === apex) as Pt;
				const b = [...pts].reverse().find((p) => p.x === apex) as Pt;
				const lx = side === "right" ? apex + LABEL_PAD : apex - LABEL_PAD;
				const la: RoutedLabel["anchor"] = side === "right" ? "start" : "end";
				const list: RoutedLabel[] = [];
				for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
					list.push({
						x: lx,
						y: a.y + (b.y - a.y) * t + 4,
						text: e.label,
						anchor: la,
					});
				}
				candidates.set(e.key, list);
			}
			continue;
		}

		// Forward: straight, jogged, or chained through virtual nodes.
		const chain = e.chain && e.chain.length > 2 ? e.chain : [e.from, e.to];
		const points = chain
			.map((id) => placements.get(id))
			.filter((p): p is RoutePlacement => p !== undefined);
		if (points.length < 2) continue;
		const first = points[0] as RoutePlacement;
		const last = points[points.length - 1] as RoutePlacement;
		const start = anchor(first, "source", exitLanes.get(e) ?? first.cx);
		const end = anchor(last, "target", entryLanes.get(e) ?? last.cx);

		const parts: string[] = [`M ${n(start.x)} ${n(start.y)}`];
		const pts: Pt[] = [{ x: start.x, y: start.y }];
		let prevX = start.x;
		let prevY = start.y;
		let kind: RouteKind = points.length > 2 ? "chain" : "straight";
		for (let i = 1; i < points.length; i++) {
			const p = points[i] as RoutePlacement;
			const isLast = i === points.length - 1;
			const cx = isLast ? end.x : p.cx;
			const targetY = isLast ? end.y : p.cy;
			if (Math.abs(cx - prevX) < 1) {
				parts.push(`L ${n(cx)} ${n(targetY)}`);
			} else {
				if (kind === "straight") kind = "jog";
				const fallback = (prevY + targetY) / 2;
				const jogY = jogs.get(`${e.key}:${i - 1}`) ?? fallback;
				const dir = cx > prevX ? 1 : -1;
				parts.push(
					`L ${n(prevX)} ${n(jogY - r)}`,
					`Q ${n(prevX)} ${n(jogY)} ${n(prevX + dir * r)} ${n(jogY)}`,
					`L ${n(cx - dir * r)} ${n(jogY)}`,
					`Q ${n(cx)} ${n(jogY)} ${n(cx)} ${n(jogY + r)}`,
					`L ${n(cx)} ${n(targetY)}`,
				);
				pts.push({ x: prevX, y: jogY }, { x: cx, y: jogY });
			}
			pts.push({ x: cx, y: targetY });
			prevX = cx;
			prevY = targetY;
		}
		routed.push({ key: e.key, kind, d: parts.join(" ") });
		polylines.set(e.key, pts);
		if (e.label) {
			candidates.set(e.key, forwardCandidates(e.label, pts));
		}
	}

	// Labels: the candidate with the least in its way. Covering a node is
	// worst; a line through the text and covering another label are as bad
	// as each other, since both make the label unreadable; ties go to the
	// earlier candidate, so each kind's preferred spot wins when it is
	// clear.
	const nodeBoxes: Box[] = [...placements.values()]
		.filter((p) => !p.virtual)
		.map((p) => ({
			x1: p.x - 2,
			y1: p.y - 2,
			x2: p.x + p.width + 2,
			y2: p.y + p.height + 2,
		}));
	const placed: Box[] = [];
	for (const edge of routed) {
		const list = candidates.get(edge.key);
		if (!list || list.length === 0) continue;
		let best: RoutedLabel = list[0] as RoutedLabel;
		let bestScore = Number.POSITIVE_INFINITY;
		for (const c of list) {
			const box = labelBox(c);
			let score = 0;
			for (const b of nodeBoxes) if (overlaps(box, b)) score += 100;
			for (const b of placed) if (overlaps(box, b)) score += 10;
			for (const [key, pts] of polylines) {
				if (key !== edge.key && polylineCrosses(pts, box)) score += 10;
			}
			if (score < bestScore) {
				bestScore = score;
				best = c;
			}
			if (score === 0) break;
		}
		placed.push(labelBox(best));
		edge.label = best;
	}

	const bounds = { x1: 0, y1: 0, x2: 0, y2: 0 };
	const grow = (b: Box) => {
		bounds.x1 = Math.min(bounds.x1, b.x1);
		bounds.y1 = Math.min(bounds.y1, b.y1);
		bounds.x2 = Math.max(bounds.x2, b.x2);
		bounds.y2 = Math.max(bounds.y2, b.y2);
	};
	for (const b of nodeBoxes) grow(b);
	for (const pts of polylines.values()) {
		for (const p of pts) grow({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
	}
	for (const b of placed) grow(b);

	return { edges: routed, bounds };
}

/** Candidate label positions for a straight / jogged / chained path.
 * Near the source first, so a decision's label sits by the decision:
 * beside the descent just after the first turn (or beside a straight
 * drop just below the source), then beside the final descent, then on a
 * horizontal run, each on either side. */
function forwardCandidates(text: string, pts: Pt[]): RoutedLabel[] {
	const out: RoutedLabel[] = [];
	const n = pts.length;
	const last = pts[n - 1] as Pt;
	const beforeLast = pts[n - 2] as Pt;
	const firstP = pts[0] as Pt;
	const vertical = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1;
	const beside = (x: number, y: number) => {
		out.push({ x: x + LABEL_PAD, y, text, anchor: "start" });
		out.push({ x: x - LABEL_PAD, y, text, anchor: "end" });
	};
	// The first vertical run after the first turn, or the straight drop.
	let i = 0;
	while (i < n - 1 && vertical(pts[i] as Pt, pts[i + 1] as Pt)) i++;
	if (i === n - 1) {
		// Straight: just below the source, then midway.
		beside(firstP.x, firstP.y + 18);
		beside(firstP.x, (firstP.y + last.y) / 2 + 4);
	} else {
		// pts[i] → pts[i+1] is the first horizontal; the run after it
		// descends toward the target.
		const turn = pts[i + 1] as Pt;
		const below = pts[i + 2] ?? last;
		const top = Math.min(turn.y + 18, (turn.y + below.y) / 2 + 4);
		beside(turn.x, top);
		if (vertical(beforeLast, last) && beforeLast !== turn) {
			beside(last.x, (beforeLast.y + last.y) / 2 + 4);
		} else {
			beside(turn.x, (turn.y + below.y) / 2 + 4);
		}
	}
	for (let k = 0; k < n - 1; k++) {
		const a = pts[k] as Pt;
		const b = pts[k + 1] as Pt;
		if (Math.abs(a.y - b.y) < 1 && Math.abs(a.x - b.x) > 24) {
			out.push({ x: (a.x + b.x) / 2, y: a.y - 4, text, anchor: "middle" });
			out.push({
				x: (a.x + b.x) / 2,
				y: a.y + LABEL_H,
				text,
				anchor: "middle",
			});
		}
	}
	beside(last.x, last.y - 8);
	return out;
}

function labelBox(l: RoutedLabel): Box {
	const w = estimateTextWidth(l.text, FONT_SIZE_LABEL);
	const x1 =
		l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
	return { x1, y1: l.y - LABEL_H + 2, x2: x1 + w, y2: l.y + 3 };
}

function overlaps(a: Box, b: Box): boolean {
	return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function polylineCrosses(pts: Pt[], box: Box): boolean {
	for (let i = 0; i < pts.length - 1; i++) {
		if (segmentCrosses(pts[i] as Pt, pts[i + 1] as Pt, box)) return true;
	}
	return false;
}

function segmentCrosses(a: Pt, b: Pt, box: Box): boolean {
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	if (maxX < box.x1 || minX > box.x2 || maxY < box.y1 || minY > box.y2)
		return false;
	if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return true; // axis-aligned, bbox test suffices
	// Diagonal: sample along the segment.
	for (let t = 0; t <= 1; t += 0.1) {
		const x = a.x + (b.x - a.x) * t;
		const y = a.y + (b.y - a.y) * t;
		if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) return true;
	}
	return false;
}

/** Group placements into ranks by centre line. */
function rankRows(
	placements: Map<string, RoutePlacement>,
): { top: number; bottom: number; ids: string[] }[] {
	const rows: { top: number; bottom: number; ids: string[]; cy: number }[] = [];
	for (const p of placements.values()) {
		const row = rows.find((r) => Math.abs(r.cy - p.cy) < 1);
		if (row) {
			row.ids.push(p.id);
			if (!p.virtual) {
				row.top = Math.min(row.top, p.y);
				row.bottom = Math.max(row.bottom, p.y + p.height);
			}
		} else {
			rows.push({
				cy: p.cy,
				ids: [p.id],
				top: p.virtual ? p.cy : p.y,
				bottom: p.virtual ? p.cy : p.y + p.height,
			});
		}
	}
	rows.sort((a, b) => a.cy - b.cy);
	return rows.map(({ top, bottom, ids }) => ({ top, bottom, ids }));
}

/** Forward segments that jog across the gap below a rank: two whose
 * horizontals would overlap get different heights, otherwise they share
 * one. Slots sit high in the gap so the descent into the target stays long
 * enough to carry a label. Keyed `${edge.key}:${segment}`. */
function assignJogSlots(
	forward: RouteEdge[],
	placements: Map<string, RoutePlacement>,
	rows: { top: number; bottom: number; ids: string[] }[],
	rankOf: Map<string, number>,
): Map<string, number> {
	const perGap = new Map<number, { key: string; x1: number; x2: number }[]>();
	for (const e of forward) {
		const chain = e.chain && e.chain.length > 2 ? e.chain : [e.from, e.to];
		for (let i = 0; i < chain.length - 1; i++) {
			const a = placements.get(chain[i] ?? "");
			const b = placements.get(chain[i + 1] ?? "");
			if (!a || !b || Math.abs(a.cx - b.cx) < 1) continue;
			const rank = rankOf.get(a.id) ?? 0;
			const list = perGap.get(rank) ?? [];
			list.push({
				key: `${e.key}:${i}`,
				x1: Math.min(a.cx, b.cx),
				x2: Math.max(a.cx, b.cx),
			});
			perGap.set(rank, list);
		}
	}
	const out = new Map<string, number>();
	for (const [rank, list] of perGap) {
		const bottom = rows[rank]?.bottom ?? 0;
		const top = rows[rank + 1]?.top ?? bottom + 56;
		list.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
		// Interval colouring: the first slot whose segments all end before
		// this one starts.
		const slots: number[] = []; // right end of the last segment in each slot
		const slotOf = new Map<string, number>();
		for (const seg of list) {
			let k = slots.findIndex((end) => end < seg.x1 - 1);
			if (k < 0) {
				k = slots.length;
				slots.push(seg.x2);
			} else {
				slots[k] = seg.x2;
			}
			slotOf.set(seg.key, k);
		}
		const count = slots.length;
		const step = Math.min(
			JOG_STEP,
			Math.max(4, (top - bottom - 16) / Math.max(count, 1)),
		);
		const first = bottom + (top - bottom) * 0.35 - ((count - 1) / 2) * step;
		for (const seg of list) {
			out.set(seg.key, first + (slotOf.get(seg.key) ?? 0) * step);
		}
	}
	return out;
}

/** Path data for an axis-aligned polyline with rounded corners. */
export function roundedPath(pts: Pt[], r: number): string {
	const first = pts[0];
	if (!first) return "";
	const parts = [`M ${n(first.x)} ${n(first.y)}`];
	for (let i = 1; i < pts.length; i++) {
		const prev = pts[i - 1] as Pt;
		const cur = pts[i] as Pt;
		const next = pts[i + 1];
		if (!next) {
			parts.push(`L ${n(cur.x)} ${n(cur.y)}`);
			break;
		}
		// Corner at `cur`: stop r short, curve through it, continue.
		const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
		const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
		const rr = Math.min(r, inLen / 2, outLen / 2);
		const ix = cur.x - Math.sign(cur.x - prev.x) * rr;
		const iy = cur.y - Math.sign(cur.y - prev.y) * rr;
		const ox = cur.x + Math.sign(next.x - cur.x) * rr;
		const oy = cur.y + Math.sign(next.y - cur.y) * rr;
		parts.push(
			`L ${n(ix)} ${n(iy)}`,
			`Q ${n(cur.x)} ${n(cur.y)} ${n(ox)} ${n(oy)}`,
		);
	}
	return parts.join(" ");
}

/** Shift every coordinate in path data by (dx, dy). Paths from the router
 * use only M, L, Q and C with absolute coordinates. */
export function translatePath(d: string, dx: number, dy: number): string {
	if (dx === 0 && dy === 0) return d;
	const tokens = d.split(/[\s,]+/);
	const out: string[] = [];
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i] as string;
		if (/^[MLQC]$/.test(t)) {
			out.push(t);
			i++;
			continue;
		}
		const x = Number(t);
		const y = Number(tokens[i + 1]);
		out.push(n(x + dx), n(y + dy));
		i += 2;
	}
	return out.join(" ");
}
