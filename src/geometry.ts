import { FONT_SIZE_LABEL } from "./style.ts";
import { estimateTextWidth } from "./svg.ts";

/** Axis-aligned geometry shared by renderers and the diagnostics check. */

export type Pt = { x: number; y: number };

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function inflate(r: Rect, by: number): Rect {
	return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

/** The rectangle an axis-aligned segment occupies, padded. */
export function segmentRect(a: Pt, b: Pt, pad: number): Rect {
	const x = Math.min(a.x, b.x) - pad;
	const y = Math.min(a.y, b.y) - pad;
	return {
		x,
		y,
		w: Math.abs(a.x - b.x) + pad * 2,
		h: Math.abs(a.y - b.y) + pad * 2,
	};
}

/** The box a text label occupies, from its baseline point and anchor. */
export function labelRect(
	text: string,
	x: number,
	y: number,
	anchor: "start" | "middle" | "end",
	fontSize: number = FONT_SIZE_LABEL,
): Rect {
	const w = estimateTextWidth(text, fontSize);
	const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
	return { x: left, y: y - fontSize, w, h: fontSize + 2 };
}

/** Liang–Barsky-style segment vs axis-aligned-rect intersection. Returns
 * true if the open segment passes through any interior point of the rect;
 * touching the boundary does not count. */
export function segmentIntersectsRect(p: Pt, q: Pt, rect: Rect): boolean {
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	let tEnter = 0;
	let tExit = 1;
	const slabs: Array<[number, number]> = [
		[-dx, p.x - rect.x],
		[dx, rect.x + rect.w - p.x],
		[-dy, p.y - rect.y],
		[dy, rect.y + rect.h - p.y],
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
	return tEnter < tExit && tExit > 0 && tEnter < 1;
}
