import {
	inflate,
	type Pt,
	type Rect,
	rectsOverlap,
	segmentIntersectsRect,
} from "./geometry.ts";

/**
 * What a renderer drew, as geometry: boxes, the segments of every edge,
 * the text it placed, and the arrowheads. A test checks every fixture's
 * diagnostics for the things a reader would see as wrong: a line through
 * a box it does not connect, a label on a box or on another label or on
 * someone else's line, two arrowheads at one point, two boxes overlapping.
 * Renderers that expose `diagnostics()` get this check for free.
 */

export interface DiagnosticBox {
	id: string;
	rect: Rect;
	/** Boxes an edge may cross freely: a namespace frame, a group. Only
	 * `solid` boxes count as obstacles. */
	solid: boolean;
}

export interface DiagnosticSegment {
	/** The edge's key, shared by all its segments. */
	edge: string;
	/** Box ids the edge connects; crossing those is fine. */
	ends: string[];
	a: Pt;
	b: Pt;
}

export interface DiagnosticLabel {
	text: string;
	rect: Rect;
	/** The edge the label belongs to, when it is an edge label. */
	edge?: string;
}

export interface DiagnosticMarker {
	edge: string;
	x: number;
	y: number;
}

export interface RenderDiagnostics {
	boxes: DiagnosticBox[];
	segments: DiagnosticSegment[];
	labels: DiagnosticLabel[];
	markers: DiagnosticMarker[];
}

const at = (p: Pt) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

/** Everything wrong with a drawing, one line each; empty when it is clean. */
export function findProblems(d: RenderDiagnostics): string[] {
	const out: string[] = [];
	const solid = d.boxes.filter((b) => b.solid);

	for (const s of d.segments) {
		for (const box of solid) {
			if (s.ends.includes(box.id)) continue;
			if (segmentIntersectsRect(s.a, s.b, inflate(box.rect, -1)))
				out.push(
					`edge ${s.edge} crosses ${box.id} between ${at(s.a)} and ${at(s.b)}`,
				);
		}
	}

	for (const [i, label] of d.labels.entries()) {
		const rect = inflate(label.rect, -1);
		for (const box of solid) {
			if (rectsOverlap(rect, box.rect))
				out.push(`label "${label.text}" sits on ${box.id}`);
		}
		for (const other of d.labels.slice(i + 1)) {
			if (rectsOverlap(rect, inflate(other.rect, -1)))
				out.push(`label "${label.text}" overlaps label "${other.text}"`);
		}
		for (const s of d.segments) {
			if (s.edge === label.edge) continue;
			if (segmentIntersectsRect(s.a, s.b, rect))
				out.push(`label "${label.text}" sits on edge ${s.edge}`);
		}
	}

	for (const [i, m] of d.markers.entries()) {
		for (const other of d.markers.slice(i + 1)) {
			if (Math.hypot(m.x - other.x, m.y - other.y) < 6)
				out.push(`markers of ${m.edge} and ${other.edge} meet at ${at(m)}`);
		}
	}

	for (const [i, box] of solid.entries()) {
		for (const other of solid.slice(i + 1)) {
			if (rectsOverlap(inflate(box.rect, -1), inflate(other.rect, -1)))
				out.push(`${box.id} overlaps ${other.id}`);
		}
	}

	return out;
}
