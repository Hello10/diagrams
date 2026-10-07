/**
 * Shared hierarchical-layout primitives used by both the flowchart and state
 * renderers. Each function is pure: it operates on the inputs it's given and
 * returns (or mutates) explicit output, with no module-level state.
 *
 * The pipeline is:
 *   1. `classifyBackEdges` — DFS to detect cycle-closing edges.
 *   2. `assignRanks` — longest-path + push-down for vertical placement.
 *   3. `insertVirtualNodes` — fill in synthetic ranks for cross-rank edges
 *      so within-rank ordering and edge routing have something to chew on.
 *   4. `reorderRanksByMedian` — alternate-direction sweeps using the
 *      median-of-neighbours heuristic; a `tiebreak` callback supplies the
 *      domain-specific secondary ordering (lane / declaration order / …).
 *   5. `assignColumnPositions` — Y by cumulative rank height; X by shared
 *      column-index. Returns a placements map plus total width/height.
 *   6. `barycenterLoneRanks` — re-centre lone-rank rows on the average X of
 *      their connected neighbours; iterate to convergence.
 *
 * Each renderer keeps any domain-specific work (cluster-member adjacency for
 * flowchart subgraphs, compound recursion for state, lane computation, etc.)
 * in its own file and threads it in via callbacks or post-passes.
 */

/** Minimum shape a layout function needs from a node: an id and a box size. */
export type LayoutNodeLike = {
	id: string;
	width: number;
	height: number;
};

/** Minimum shape a layout function needs from an edge. `chain` is populated
 * by `insertVirtualNodes`; callers may treat it as opaque. */
export type EdgeLike = {
	from: string;
	to: string;
	isBack: boolean;
	chain?: string[];
};

/** Single-step edge between two adjacent ranks. Used by within-rank ordering
 * and the barycenter pass. */
export type Segment = { from: string; to: string };

/** A placed node's geometry. */
export interface Placement<N extends LayoutNodeLike> {
	node: N;
	x: number;
	y: number;
	cx: number;
	cy: number;
}

// ─── 1. Back-edge classification ─────────────────────────────────────────────

/** DFS the directed edge set; any edge that reaches a currently-visiting node
 * is a back-edge. Self-loops are always back-edges. */
export function classifyBackEdges<N extends LayoutNodeLike, E extends EdgeLike>(
	nodes: N[],
	edges: E[],
): Set<E> {
	const back = new Set<E>();
	const adj = new Map<string, E[]>();
	for (const n of nodes) adj.set(n.id, []);
	for (const e of edges) {
		if (e.from === e.to) {
			back.add(e);
			continue;
		}
		adj.get(e.from)?.push(e);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function dfs(id: string): void {
		visiting.add(id);
		for (const e of adj.get(id) ?? []) {
			if (visiting.has(e.to)) {
				back.add(e);
				continue;
			}
			if (!visited.has(e.to)) dfs(e.to);
		}
		visiting.delete(id);
		visited.add(id);
	}
	for (const n of nodes) {
		if (!visited.has(n.id)) dfs(n.id);
	}
	return back;
}

// ─── 2. Rank assignment ──────────────────────────────────────────────────────

/** Longest-path ranking followed by a push-down pass that shifts nodes down
 * to sit just above their nearest successor. The push-down keeps sibling
 * branches aligned at their convergence rank instead of leaving slack. */
export function assignRanks<N extends LayoutNodeLike, E extends EdgeLike>(
	nodes: N[],
	forwardEdges: E[],
): Map<string, number> {
	const ranks = new Map<string, number>();
	for (const n of nodes) ranks.set(n.id, 0);

	const maxIter = nodes.length + 1;
	for (let i = 0; i < maxIter; i++) {
		let changed = false;
		for (const e of forwardEdges) {
			const f = ranks.get(e.from) ?? 0;
			const target = ranks.get(e.to) ?? 0;
			if (f + 1 > target) {
				ranks.set(e.to, f + 1);
				changed = true;
			}
		}
		if (!changed) break;
	}

	const successors = new Map<string, string[]>();
	for (const e of forwardEdges) {
		const list = successors.get(e.from) ?? [];
		list.push(e.to);
		successors.set(e.from, list);
	}
	for (let i = 0; i < maxIter; i++) {
		let changed = false;
		for (const n of nodes) {
			const succs = successors.get(n.id) ?? [];
			if (succs.length === 0) continue;
			let minSucc = Number.POSITIVE_INFINITY;
			for (const s of succs) {
				const r = ranks.get(s);
				if (r !== undefined && r < minSucc) minSucc = r;
			}
			if (!Number.isFinite(minSucc)) continue;
			const maxAllowed = minSucc - 1;
			const current = ranks.get(n.id) ?? 0;
			if (maxAllowed > current) {
				ranks.set(n.id, maxAllowed);
				changed = true;
			}
		}
		if (!changed) break;
	}

	return ranks;
}

// ─── 3. Virtual-node insertion ───────────────────────────────────────────────

/** For each forward edge spanning more than one rank, insert synthetic nodes
 * at each intermediate rank so within-rank ordering can sequence them along
 * with the real nodes. Sets each edge's `chain` to `[from, …virtual ids…, to]`.
 * For back-edges and self-loops, sets `chain = [from, to]`.
 *
 * The `makeVirtual` callback constructs domain-specific virtual nodes (so
 * each renderer can keep its own LayoutNode shape). The returned array
 * contains every virtual node created. */
export function insertVirtualNodes<
	N extends LayoutNodeLike,
	E extends EdgeLike,
>(edges: E[], ranks: Map<string, number>, makeVirtual: (id: string) => N): N[] {
	const virtualNodes: N[] = [];
	let virtCounter = 0;
	for (const e of edges) {
		if (e.isBack || e.from === e.to) {
			e.chain = [e.from, e.to];
			continue;
		}
		const fromRank = ranks.get(e.from) ?? 0;
		const toRank = ranks.get(e.to) ?? 0;
		const span = toRank - fromRank;
		if (span <= 1) {
			e.chain = [e.from, e.to];
			continue;
		}
		const chain: string[] = [e.from];
		for (let r = fromRank + 1; r < toRank; r++) {
			const vid = `__virt_${++virtCounter}`;
			chain.push(vid);
			virtualNodes.push(makeVirtual(vid));
			ranks.set(vid, r);
		}
		chain.push(e.to);
		e.chain = chain;
	}
	return virtualNodes;
}

/** Flatten a list of (possibly multi-step) edges into single-rank segments.
 * Back-edges and self-loops are skipped. */
export function buildSegmentEdges<E extends EdgeLike>(edges: E[]): Segment[] {
	const segments: Segment[] = [];
	for (const e of edges) {
		if (e.isBack || !e.chain) continue;
		for (let i = 0; i < e.chain.length - 1; i++) {
			segments.push({ from: e.chain[i] ?? "", to: e.chain[i + 1] ?? "" });
		}
	}
	return segments;
}

// ─── 4. Median-heuristic reordering ──────────────────────────────────────────

/** Alternate-direction sweeps that reorder nodes within each rank to reduce
 * edge crossings. Within each sweep, every rank's order is computed from the
 * median position of its segment-neighbours in the previous rank (looking up
 * for top-down sweeps, down for bottom-up).
 *
 * When two nodes tie on median, the `tiebreak` callback breaks the tie. This
 * is where domain-specific ordering plugs in: flowchart uses a lane index
 * (which fan-out branch the node belongs to), state uses declaration order. */
export function reorderRanksByMedian<N extends LayoutNodeLike>(
	groups: Map<number, N[]>,
	sortedRanks: number[],
	segmentEdges: Segment[],
	tiebreak: (a: N, b: N) => number,
	sweeps = 4,
): void {
	if (sortedRanks.length < 2) return;
	for (let i = 0; i < sweeps; i++) {
		const goingDown = i % 2 === 0;
		const order = goingDown ? sortedRanks : [...sortedRanks].reverse();
		for (let j = 1; j < order.length; j++) {
			const current = order[j];
			const neighbour = order[j - 1];
			if (current === undefined || neighbour === undefined) continue;
			reorderRank(
				groups,
				current,
				neighbour,
				segmentEdges,
				goingDown,
				tiebreak,
			);
		}
	}
}

function reorderRank<N extends LayoutNodeLike>(
	groups: Map<number, N[]>,
	currentRank: number,
	neighbourRank: number,
	segmentEdges: Segment[],
	goingDown: boolean,
	tiebreak: (a: N, b: N) => number,
): void {
	const current = groups.get(currentRank);
	const neighbour = groups.get(neighbourRank);
	if (!current || !neighbour) return;

	const neighbourIndex = new Map<string, number>();
	neighbour.forEach((n, idx) => {
		neighbourIndex.set(n.id, idx);
	});

	const medians = new Map<string, number>();
	for (const n of current) {
		const positions: number[] = [];
		for (const t of segmentEdges) {
			if (goingDown && t.to === n.id) {
				const idx = neighbourIndex.get(t.from);
				if (idx !== undefined) positions.push(idx);
			} else if (!goingDown && t.from === n.id) {
				const idx = neighbourIndex.get(t.to);
				if (idx !== undefined) positions.push(idx);
			}
		}
		if (positions.length === 0) {
			medians.set(n.id, Number.POSITIVE_INFINITY);
			continue;
		}
		positions.sort((a, b) => a - b);
		const mid = Math.floor(positions.length / 2);
		const median =
			positions.length % 2 === 1
				? (positions[mid] ?? 0)
				: ((positions[mid - 1] ?? 0) + (positions[mid] ?? 0)) / 2;
		medians.set(n.id, median);
	}

	current.sort((a, b) => {
		const ma = medians.get(a.id) ?? Number.POSITIVE_INFINITY;
		const mb = medians.get(b.id) ?? Number.POSITIVE_INFINITY;
		if (ma !== mb) return ma - mb;
		return tiebreak(a, b);
	});
}

// ─── 5. Column-based placement ───────────────────────────────────────────────

/** Compute Y positions per rank (cumulative, including `rankGapY` between
 * ranks) and X positions per within-rank column. Column centers are derived
 * from per-rank adjacency constraints: for each rank, the node at column `i`
 * must clear the rank's column-`(i-1)` neighbour by `nodeGapX`. Taking the
 * max constraint across ranks gives column centers that are just wide enough
 * to fit the widest same-rank pair — narrower than the old "max width per
 * column" approach below ranks that contain a wide outlier (e.g. a compound
 * container), but still respecting the wide pair in its own rank. */
export function assignColumnPositions<N extends LayoutNodeLike>(
	groups: Map<number, N[]>,
	sortedRanks: number[],
	rankGapY: number,
	nodeGapX: number,
): {
	placements: Map<string, Placement<N>>;
	width: number;
	height: number;
} {
	const rankY = new Map<number, number>();
	let yCursor = 0;
	for (const r of sortedRanks) {
		const list = groups.get(r) ?? [];
		const rowH = Math.max(0, ...list.map((n) => n.height));
		rankY.set(r, yCursor);
		yCursor += rowH + rankGapY;
	}
	const totalHeight = Math.max(0, yCursor - rankGapY);

	const numCols = Math.max(
		0,
		...sortedRanks.map((r) => groups.get(r)?.length ?? 0),
	);
	const colCenter: number[] = new Array(numCols).fill(0);
	const colHalfMax: number[] = new Array(numCols).fill(0);
	for (let i = 0; i < numCols; i++) {
		let minCx = 0;
		let halfMax = 0;
		for (const r of sortedRanks) {
			const list = groups.get(r) ?? [];
			if (i >= list.length) continue;
			const n = list[i];
			if (!n) continue;
			let required: number;
			if (i === 0) {
				required = n.width / 2;
			} else {
				const prev = list[i - 1];
				if (!prev) continue;
				required =
					(colCenter[i - 1] ?? 0) + prev.width / 2 + nodeGapX + n.width / 2;
			}
			if (required > minCx) minCx = required;
			const half = n.width / 2;
			if (half > halfMax) halfMax = half;
		}
		colCenter[i] = minCx;
		colHalfMax[i] = halfMax;
	}
	const lastIdx = numCols - 1;
	const totalWidth =
		lastIdx >= 0 ? (colCenter[lastIdx] ?? 0) + (colHalfMax[lastIdx] ?? 0) : 0;

	const placements = new Map<string, Placement<N>>();
	let actualRight = 0;
	for (const r of sortedRanks) {
		const list = groups.get(r) ?? [];
		const rowY = rankY.get(r) ?? 0;
		list.forEach((n, i) => {
			const cx = colCenter[i] ?? 0;
			const x = cx - n.width / 2;
			placements.set(n.id, {
				node: n,
				x,
				y: rowY,
				cx,
				cy: rowY + n.height / 2,
			});
			const right = x + n.width;
			if (right > actualRight) actualRight = right;
		});
	}

	return {
		placements,
		width: Math.max(totalWidth, actualRight),
		height: totalHeight,
	};
}

// ─── 6. Barycenter refinement ────────────────────────────────────────────────

/** For each rank that contains exactly one node, slide that node to the
 * average X of its connected neighbours. Iterates so chains of lone-rank
 * nodes line up. Multi-node ranks are left alone (they keep their fixed
 * column positions, with order already controlled by the median sort). */
export function barycenterLoneRanks<N extends LayoutNodeLike>(
	placements: Map<string, Placement<N>>,
	segmentEdges: Segment[],
	sortedRanks: number[],
	groups: Map<number, N[]>,
	iterations = 20,
): void {
	for (let pass = 0; pass < iterations; pass++) {
		for (const r of sortedRanks) {
			const list = groups.get(r) ?? [];
			if (list.length !== 1) continue;
			const n = list[0];
			if (!n) continue;
			const p = placements.get(n.id);
			if (!p) continue;
			const xs: number[] = [];
			for (const t of segmentEdges) {
				if (t.to === n.id) {
					const op = placements.get(t.from);
					if (op) xs.push(op.cx);
				} else if (t.from === n.id) {
					const op = placements.get(t.to);
					if (op) xs.push(op.cx);
				}
			}
			if (xs.length === 0) continue;
			const barycenter = xs.reduce((a, b) => a + b, 0) / xs.length;
			placements.set(n.id, {
				...p,
				x: barycenter - n.width / 2,
				cx: barycenter,
			});
		}
	}
}
