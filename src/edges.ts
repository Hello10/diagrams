/**
 * Shared edge-routing helpers usable across diagram renderers.
 *
 * Today this module hosts `computeFanLanes` — the same algorithm that
 * distributes outgoing-edge exit X positions on a fan-out source can be
 * reused for incoming-edge entry positions on a fan-in target. Both are
 * essentially the same calculation: group edges by the node they share,
 * aim each lane at its opposite end, then spread out so labels and jogs
 * don't overlap.
 */

/** Geometry the fan-lane helper needs about the "anchor" node — the box
 * whose top (fan-in) or bottom (fan-out) the edges are sharing. */
export interface FanAnchor {
	/** Left edge of the box. */
	x: number;
	/** Box width. */
	width: number;
	/** Box center X. Used as fallback when `aimAt` returns undefined. */
	cx: number;
}

export interface FanLaneInput<E> {
	/** Edges to compute lane X positions for. */
	edges: readonly E[];
	/** Group key — typically the source id for fan-out, target id for
	 * fan-in. Edges sharing a key compete for distinct lanes. */
	groupBy: (edge: E) => string;
	/** Geometry of the anchor node for a group. Return `undefined` to skip
	 * the group entirely (e.g. when the anchor isn't placed yet). */
	anchor: (groupKey: string) => FanAnchor | undefined;
	/** X the lane should aim at — typically the opposite endpoint's center.
	 * Return `undefined` to fall back to the anchor's own center. */
	aimAt: (edge: E) => number | undefined;
	/** Minimum horizontal gap between adjacent lanes. Default 18. */
	minGap?: number;
	/** Cap on the side margin kept clear inside the box (so lanes don't
	 * touch the box corner). Effective margin is
	 * `min(marginMax, width / 4)`. Default 12. */
	marginMax?: number;
}

/** Distribute lane X positions for a set of edges that all attach to the
 * same side of an anchor node.
 *
 * Pipeline:
 *   1. Group edges by `groupBy(edge)`.
 *   2. For each group with >1 edge, aim each lane at `aimAt(edge)`, clamped
 *      to a margin inside the anchor's horizontal extent.
 *   3. Sort the lanes left-to-right and enforce `minGap` between adjacent
 *      lanes (pushing right).
 *   4. If the rightmost lane would overflow the right margin, shift the
 *      whole packed group left so it fits.
 *
 * Returns only the edges that ended up with a non-default lane (i.e. edges
 * in single-edge groups are omitted — callers fall back to the anchor's
 * center for those). */
export function computeFanLanes<E>(input: FanLaneInput<E>): Map<E, number> {
	const out = new Map<E, number>();
	const minGap = input.minGap ?? 18;
	const marginMax = input.marginMax ?? 12;

	const groups = new Map<string, E[]>();
	for (const e of input.edges) {
		const key = input.groupBy(e);
		const list = groups.get(key) ?? [];
		list.push(e);
		groups.set(key, list);
	}

	for (const [groupKey, group] of groups) {
		if (group.length <= 1) continue;
		const anchor = input.anchor(groupKey);
		if (!anchor) continue;
		const margin = Math.min(marginMax, anchor.width / 4);
		const minX = anchor.x + margin;
		const maxX = anchor.x + anchor.width - margin;

		const annotated = group.map((e) => {
			const aim = input.aimAt(e) ?? anchor.cx;
			const x = Math.max(minX, Math.min(maxX, aim));
			return { edge: e, x };
		});
		annotated.sort((a, b) => a.x - b.x);
		for (let i = 1; i < annotated.length; i++) {
			const prev = annotated[i - 1];
			const cur = annotated[i];
			if (!prev || !cur) continue;
			if (cur.x < prev.x + minGap) cur.x = prev.x + minGap;
		}
		const last = annotated[annotated.length - 1];
		if (last) {
			const overflow = last.x - maxX;
			if (overflow > 0) {
				for (const a of annotated) a.x -= overflow;
			}
		}
		for (const a of annotated) out.set(a.edge, a.x);
	}
	return out;
}
