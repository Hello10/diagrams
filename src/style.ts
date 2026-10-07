/**
 * Shared design tokens for all diagram renderers.
 *
 * Renderers import semantic tokens (COLOR_EDGE, FONT_SIZE_BODY, etc.) rather
 * than hard-coding values. Tokens are documented by purpose, not appearance —
 * "edge stroke" not "dark gray" — so palette adjustments here propagate
 * predictably across diagram types.
 */

// ─── Typography ──────────────────────────────────────────────────────────────

export const FONT_SANS = "ui-sans-serif, system-ui, sans-serif";
export const FONT_MONO = "ui-monospace, SFMono-Regular, monospace";

export const FONT_SIZE_BODY = 12;
export const FONT_SIZE_LABEL = 11;
export const FONT_SIZE_TITLE = 14;

// ─── Color palette ───────────────────────────────────────────────────────────

/** Primary text + standard edges. */
export const COLOR_TEXT = "#333";
/** Edge labels and tertiary text. */
export const COLOR_LABEL = "#444";
/** Subdued markers (group headers, note authors, etc.). */
export const COLOR_SUBDUED = "#777";
/** Subdued auxiliary text (note placement hints). */
export const COLOR_TEXT_DIM = "#888";

/** Standard edge stroke (matches COLOR_TEXT — two tokens because the role
 * differs even if today the value is the same). */
export const COLOR_EDGE = "#333";
/** Thick / emphasized edges and dark-fill node headers. */
export const COLOR_EDGE_THICK = "#1f2937";
/** Dashed auxiliary lines (lifelines, group separators). */
export const COLOR_EDGE_DASHED = "#999";

/** Default node fill. */
export const COLOR_NODE_FILL = "#ffffff";
/** Default node stroke. */
export const COLOR_NODE_STROKE = "#1f2937";

/** Compound / cluster header fill (state diagram compound, etc.). */
export const COLOR_COMPOUND_HEADER_FILL = "#1f2937";
/** Cluster / group rect border (mid-weight chrome). */
export const COLOR_CHROME_MID = "#666";
/** Chrome borders (panels, dividers, subdued separators). */
export const COLOR_CHROME_LIGHT = "#ddd";

/** Sticky note body. */
export const COLOR_NOTE_FILL = "#fef3a3";
/** Sticky note folded-corner triangle. */
export const COLOR_NOTE_FOLD = "#e2cf6a";
/** Sticky note border. */
export const COLOR_NOTE_BORDER = "#c9a93a";

/** Subgraph rectangle fill (flowchart cluster). */
export const COLOR_SUBGRAPH_FILL = "#f3f4f6";
/** Subgraph rectangle border. */
export const COLOR_SUBGRAPH_BORDER = "#9ca3af";
/** Subgraph header text. */
export const COLOR_SUBGRAPH_LABEL = "#374151";

/** Sequence-diagram activation bar fill. */
export const COLOR_ACTIVATION_FILL = "#dde9f5";
/** Sequence-diagram activation bar border. */
export const COLOR_ACTIVATION_STROKE = "#3a78b5";

// ─── Stroke widths ───────────────────────────────────────────────────────────

export const STROKE_DEFAULT = 1;
export const STROKE_BOLD = 1.2;
export const STROKE_EMPHASIZED = 1.5;
export const STROKE_THICK = 2;

// ─── Radii ───────────────────────────────────────────────────────────────────

export const RADIUS_NODE = 4;
export const RADIUS_COMPOUND = 6;

// ─── Outer layout primitives ─────────────────────────────────────────────────

/** Vertical room reserved for the optional diagram title above the canvas. */
export const TITLE_HEIGHT = 30;
/** Outer canvas padding around the diagram body. */
export const PADDING_OUTER = 40;
