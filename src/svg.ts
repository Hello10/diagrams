/**
 * Shared SVG rendering primitives used by every diagram renderer.
 *
 * Everything in here is a pure function — no `this`, no AST coupling. Subclass
 * methods that need to compose these primitives import them directly.
 */

import {
	COLOR_COMPOUND_HEADER_FILL,
	COLOR_EDGE,
	COLOR_LABEL,
	COLOR_NOTE_BORDER,
	COLOR_NOTE_FILL,
	COLOR_NOTE_FOLD,
	COLOR_TEXT,
	FONT_SANS,
	FONT_SIZE_BODY,
	FONT_SIZE_LABEL,
	FONT_SIZE_TITLE,
	RADIUS_COMPOUND,
	STROKE_EMPHASIZED,
} from "./style.ts";

/** Escape characters that have special meaning in SVG text/attribute values. */
export function svgEsc(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Approximate the rendered width of a text run. Conservative enough for
 * layout decisions but not pixel-exact. */
export function estimateTextWidth(
	text: string,
	fontSize: number = FONT_SIZE_BODY,
): number {
	return text.length * fontSize * 0.6;
}

/** Emit a triangular `<marker>` definition for an arrowhead. */
export function arrowMarker(id: string, fill: string = COLOR_EDGE): string {
	return `<marker id="${id}" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${fill}"/></marker>`;
}

// ─── SVG envelope ────────────────────────────────────────────────────────────

export interface SvgRootOptions {
	width: number;
	height: number;
	/** The SVG body content (everything inside `<svg>...</svg>` except the
	 * shared `<style>` block and optional `<defs>`). */
	body: string;
	/** Optional `<defs>` contents (arrow markers, gradients, etc). */
	defs?: string;
	/** Additional CSS declarations appended to the default `text` rule.
	 * E.g. `"fill: #000; cursor: default;"` for diagrams that need their own
	 * text styling on top of the shared defaults. */
	extraTextStyles?: string;
}

/** Build the standard SVG document envelope. Every renderer uses the same
 * `<style>` defaults (FONT_SANS, FONT_SIZE_BODY); pass `extraTextStyles` to
 * append additional CSS to the `text` rule. Diagram-type-specific defs
 * (e.g. arrow markers) go in `defs`. */
export function svgRoot(opts: SvgRootOptions): string {
	const { width, height, body, defs, extraTextStyles } = opts;
	const textRule = `text { font-family: ${FONT_SANS}; font-size: ${FONT_SIZE_BODY}px;${extraTextStyles ? ` ${extraTextStyles}` : ""} }`;
	const defsBlock = defs ? `<defs>${defs}</defs>` : "";
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<style>${textRule}</style>`,
		defsBlock,
		body,
		`</svg>`,
	].join("\n");
}

// ─── Text helpers ────────────────────────────────────────────────────────────

export type TextAnchor = "start" | "middle" | "end";

/** Render an edge label — small text in the label color. Used wherever a
 * diagram annotates an edge or arrow with a string. */
export function edgeLabel(
	x: number,
	y: number,
	text: string,
	anchor: TextAnchor = "start",
): string {
	const anchorAttr = anchor === "start" ? "" : ` text-anchor="${anchor}"`;
	return `<text x="${x}" y="${y}"${anchorAttr} font-size="${FONT_SIZE_LABEL}" fill="${COLOR_LABEL}">${svgEsc(text)}</text>`;
}

/** Render a centered diagram title above the canvas. Returns an empty string
 * when `text` is undefined / empty so callers can splice unconditionally. */
export function renderTitle(
	text: string | undefined,
	centerX: number,
	y: number,
): string {
	if (!text) return "";
	return `<text x="${centerX}" y="${y}" text-anchor="middle" font-weight="bold" font-size="${FONT_SIZE_TITLE}" fill="${COLOR_TEXT}">${svgEsc(text)}</text>`;
}

// ─── Compound container frame ───────────────────────────────────────────────

export interface CompoundFrameOptions {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Height of the dark header strip at the top. */
	headerHeight: number;
	/** Label shown in the header strip. */
	label: string;
	/** Corner radius for both the outer body and the header strip's top
	 * corners. Defaults to `RADIUS_COMPOUND`. */
	radius?: number;
}

/** Render the "card" frame for a compound container (state-diagram substate,
 * flowchart subgraph, etc.): a white rounded body with a dark header strip
 * at the top carrying a centered white label. Used by every renderer that
 * draws nested scopes so the visual language stays consistent. */
export function renderCompoundFrame(opts: CompoundFrameOptions): string {
	const { x, y, width, height, headerHeight, label } = opts;
	const radius = opts.radius ?? RADIUS_COMPOUND;
	const header = [
		`M ${x} ${y + radius}`,
		`a ${radius} ${radius} 0 0 1 ${radius} -${radius}`,
		`h ${width - radius * 2}`,
		`a ${radius} ${radius} 0 0 1 ${radius} ${radius}`,
		`v ${headerHeight - radius}`,
		`h -${width}`,
		`z`,
	].join(" ");
	return [
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white" stroke="${COLOR_COMPOUND_HEADER_FILL}" stroke-width="${STROKE_EMPHASIZED}"/>`,
		`<path d="${header}" fill="${COLOR_COMPOUND_HEADER_FILL}"/>`,
		`<text x="${x + width / 2}" y="${y + headerHeight / 2 + 4}" text-anchor="middle" fill="white" font-weight="600">${svgEsc(label)}</text>`,
	].join("");
}

// ─── Sticky note ─────────────────────────────────────────────────────────────

/** Width of the folded-corner triangle. Fixed for visual consistency — every
 * sticky note in every diagram type uses the same fold. */
const NOTE_FOLD = 8;

export interface StickyNoteOptions {
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
}

/** Render a sticky-note shape (rounded rectangle body with a folded bottom-right
 * corner) plus its label text. Used by state-diagram notes and
 * sequence-diagram notes — same visual treatment in both. */
export function renderStickyNote(opts: StickyNoteOptions): string {
	const { x, y, width: w, height: h, text } = opts;
	const body = [
		`M ${x} ${y}`,
		`L ${x + w} ${y}`,
		`L ${x + w} ${y + h - NOTE_FOLD}`,
		`L ${x + w - NOTE_FOLD} ${y + h}`,
		`L ${x} ${y + h}`,
		"Z",
	].join(" ");
	const foldTri = [
		`M ${x + w - NOTE_FOLD} ${y + h}`,
		`L ${x + w} ${y + h - NOTE_FOLD}`,
		`L ${x + w - NOTE_FOLD} ${y + h - NOTE_FOLD}`,
		"Z",
	].join(" ");
	return [
		`<path d="${body}" fill="${COLOR_NOTE_FILL}" stroke="${COLOR_NOTE_BORDER}" stroke-width="1"/>`,
		`<path d="${foldTri}" fill="${COLOR_NOTE_FOLD}" stroke="${COLOR_NOTE_BORDER}" stroke-width="1"/>`,
		`<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="${FONT_SIZE_LABEL}">${svgEsc(text)}</text>`,
	].join("");
}
