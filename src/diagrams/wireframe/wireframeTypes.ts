import type { DiagramAST } from "../../types.ts";

export type BaseElementNode = {
	id: string;
	type: string;
	content?: string;
	attributes: Record<string, string>;
	flags: string[];
	children?: string[];
};

// ─── Imports and component references ───────────────────────────────────────

export type WireframeUseImport =
	| {
			kind: "namespace";
			module: string;
			alias: string;
	  }
	| {
			kind: "named";
			module: string;
			names: string[];
	  };

/** The module that ships the canonical vocabulary. Nothing resolves
 * without an import; a wireframe that uses the canonical set says so with
 * `use @hello10/diagrams/ui Stack, Text, Button`. */
export const WIREFRAME_UI_MODULE = "@hello10/diagrams/ui";

/** Canonical component name → render type. `Stack` is the one layout
 * primitive; the rest are the HTML form-and-media set. */
export const WIREFRAME_UI_COMPONENTS: Record<
	string,
	WireframeCanonicalRenderType
> = {
	Stack: "stack",
	Text: "text",
	Button: "button",
	Input: "input",
	Select: "select",
	Checkbox: "checkbox",
	Radio: "radio",
	Image: "image",
	Audio: "audio",
	Video: "video",
	Table: "table",
	Dialog: "dialog",
};

export type WireframeComponentRef =
	| {
			kind: "local";
			name: string;
	  }
	| {
			kind: "named-import";
			module: string;
			name: string;
	  }
	| {
			kind: "namespace-import";
			module: string;
			alias: string;
			name: string;
	  };

// ─── Viewports ───────────────────────────────────────────────────────────────

export type WireframeViewport = {
	name: string;
	/** Frame width in CSS pixels. */
	width: number;
};

/** Named viewports and their default widths. A `viewport` declaration with
 * any other name must carry `width=`. */
export const WIREFRAME_KNOWN_VIEWPORTS: Record<string, number> = {
	mobile: 390,
	tablet: 768,
	desktop: 1280,
};

/** Width used when a wireframe declares no viewport at all. */
export const WIREFRAME_DEFAULT_VIEWPORT: WireframeViewport = {
	name: "default",
	width: 390,
};

// ─── Interactions ────────────────────────────────────────────────────────────

export type WireframeInteractionKind = "goto" | "state" | "call";

/** Name of the implicit base state every screen has. */
export const WIREFRAME_DEFAULT_STATE = "default";

// ─── Elements ────────────────────────────────────────────────────────────────

export type WireframeNodeKind =
	| "root"
	| "screen"
	| "component"
	| "repeat"
	| "modal";

export type WireframeElementNode = BaseElementNode & {
	nodeKind: WireframeNodeKind;
	/** The `id=` the author wrote. Absent for auto-generated ids. */
	declaredId?: string;
	/** Raw component reference as written: `Button`, `UI.Card`, `Stack`. */
	componentName?: string;
	/** Resolved component reference, set during validation. */
	component?: WireframeComponentRef;
	/** Spec reference for the collection or entity this node shows
	 * (`data=Show`). Promoted out of `attributes`. */
	data?: string;
	/** Interaction declared on this node: `-->|kind| target`. */
	targetKind?: WireframeInteractionKind;
	target?: string;

	// Screen-only fields.
	screenName?: string;
	/** Named states declared with `state Name … end`, in declaration order.
	 * The implicit `default` state is never listed here. */
	states?: WireframeScreenState[];
	/** Per-viewport layout overrides declared with `viewport Name … end`. */
	viewportOverrides?: WireframeViewportOverrides[];
	/** Every `call` hook reachable from this screen, including through local
	 * defines. Collected during validation. */
	hooks?: string[];
};

/** A property override targeting an existing component by its declared id.
 * Everything present replaces or extends the component's own declaration;
 * `clearFlags` lists flags written as `-flag`. */
export type WireframeOverride = {
	id: string;
	content?: string;
	attributes: Record<string, string>;
	flags: string[];
	clearFlags: string[];
	data?: string;
	targetKind?: WireframeInteractionKind;
	target?: string;
};

/** A named screen state: what differs from `default`. */
export type WireframeScreenState = {
	name: string;
	overrides: WireframeOverride[];
	/** Element ids added in this state, appended after the default tree.
	 * Modals land here. */
	children: string[];
};

export type WireframeViewportOverrides = {
	viewport: string;
	overrides: WireframeOverride[];
};

export type DefineNode = {
	name: string;
	/** `$param` names used as content inside the template. */
	params: string[];
	/** `call` hook names declared inside the template. */
	hooks: string[];
	template: string[];
};

export type WireframeAST = DiagramAST & {
	type: "wireframe";
	root: string;
	elements: Record<string, WireframeElementNode>;
	defines: Record<string, DefineNode>;
	uses: WireframeUseImport[];
	viewports: WireframeViewport[];
};

// ─── Wireflow ────────────────────────────────────────────────────────────────

/** Address of a wireflow node: a screen, optionally in a named state. */
export type WireflowScreenRef = {
	screen: string;
	state?: string;
};

export type WireflowNode =
	| { kind: "screen"; id: string; ref: WireflowScreenRef }
	| { kind: "decision"; id: string; question: string };

export type WireflowEdge = {
	from: string;
	to: string;
	/** Interaction that causes the edge. Absent for entry/exit edges without
	 * a label and for decision branches. */
	interaction?: WireframeInteractionKind;
	/** Component id (goto / state) or hook name (call) that triggers it. */
	trigger?: string;
	/** Branch label on an edge leaving a decision. */
	branch?: string;
};

export type WireflowAST = DiagramAST & {
	type: "wireflow";
	/** Node ids in declaration order. Screen node ids are their address
	 * (`Home`, `Home.paying`); decision ids are as declared. */
	order: string[];
	nodes: Record<string, WireflowNode>;
	edges: WireflowEdge[];
	/** Screen node ids with an entry edge from `[*]`. */
	entries: string[];
	/** Screen node ids with an exit edge to `[*]`. */
	exits: string[];
	/** Optional: wireframes attached by the caller so the renderer can draw
	 * real thumbnails instead of placeholder frames. Never produced by the
	 * parser and not part of the plaintext form. */
	wireframes?: Record<string, WireframeAST>;
};

// ─── Adapters ────────────────────────────────────────────────────────────────

export type WireframeCanonicalRenderType =
	| "stack"
	| "text"
	| "button"
	| "input"
	| "select"
	| "checkbox"
	| "radio"
	| "image"
	| "audio"
	| "video"
	| "table"
	| "dialog";

export type WireframeSvgRenderContext = {
	ast: WireframeAST;
	node: WireframeElementNode;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	childrenSvg?: string;
};

export type WireframeAsciiRenderContext = {
	ast: WireframeAST;
	node: WireframeElementNode;
	label: string;
};

export type WireframeLibraryComponentAdapter = {
	type?: WireframeCanonicalRenderType;
	renderSvg?: (ctx: WireframeSvgRenderContext) => string;
	renderAscii?: (ctx: WireframeAsciiRenderContext) => string;
};

export type WireframeLibraryAdapter = {
	module: string;
	components: Record<string, WireframeLibraryComponentAdapter>;
};
