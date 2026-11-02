import type { DiagramAST } from "../../types.ts";

// ─── Imports ─────────────────────────────────────────────────────────────────

export type UiImport =
	| { kind: "namespace"; module: string; alias: string }
	| { kind: "named"; module: string; names: string[] };

/** `api "<module>" name, …`: the operations a document may `in` or `out`.
 * With no names the source is formal (an OpenAPI or GraphQL document) and
 * every operation it is asked for is accepted; checking the names against
 * that document is a step outside this library. */
export type UiApi = { module: string; names: string[] };

/** The module that ships the standard elements. Imported like any other;
 * nothing is ambient. */
export const UI_STANDARD_MODULE = "@hello10/diagrams/ui";

// ─── Standard elements ───────────────────────────────────────────────────────

export type UiRenderType =
	| "stack"
	| "heading"
	| "text"
	| "link"
	| "button"
	| "input"
	| "select"
	| "checkbox"
	| "radio"
	| "image"
	| "audio"
	| "video"
	| "table"
	| "dialog"
	| "outlet";

/** What an element is, in the terms the language needs: how it draws,
 * what it takes, what it fires, and which flags it owns. Mirrors the
 * HTML5 element it stands for. `click` is an event of every element and is
 * not listed. */
export type UiElementContract = {
	type: UiRenderType;
	html: string;
	attributes: string[];
	events: string[];
	flags: string[];
	/** Flags under which the element fires nothing: a `disabled` button, a
	 * `selected` link (the one to where you already are). A frame draws no
	 * callout on an inert element. */
	inert?: string[];
};

/** Flags every element and component accepts. */
export const UI_UNIVERSAL_FLAGS = ["hidden"] as const;

/** The event every element fires. */
export const UI_UNIVERSAL_EVENT = "click";

export const UI_STANDARD_ELEMENTS: Record<string, UiElementContract> = {
	Stack: {
		type: "stack",
		html: "div",
		attributes: ["direction"],
		events: [],
		flags: [],
	},
	Heading: {
		type: "heading",
		html: "h1-h6",
		attributes: ["level"],
		events: [],
		flags: [],
	},
	Text: { type: "text", html: "p", attributes: [], events: [], flags: [] },
	Link: {
		type: "link",
		html: "a",
		attributes: ["to"],
		events: [],
		flags: ["selected"],
		inert: ["selected"],
	},
	Button: {
		type: "button",
		html: "button",
		attributes: [],
		events: [],
		flags: ["disabled", "primary", "busy"],
		inert: ["disabled"],
	},
	Input: {
		type: "input",
		html: "input",
		attributes: ["placeholder", "value", "label"],
		events: ["change", "submit", "focus", "blur"],
		flags: ["disabled", "invalid"],
		inert: ["disabled"],
	},
	Select: {
		type: "select",
		html: "select",
		attributes: ["options", "value", "placeholder", "label"],
		events: ["change"],
		flags: ["disabled"],
		inert: ["disabled"],
	},
	Checkbox: {
		type: "checkbox",
		html: "input[type=checkbox]",
		attributes: [],
		events: ["change"],
		flags: ["checked", "disabled"],
		inert: ["disabled"],
	},
	Radio: {
		type: "radio",
		html: "input[type=radio]",
		attributes: [],
		events: ["change"],
		flags: ["checked", "disabled"],
		inert: ["disabled"],
	},
	Image: {
		type: "image",
		html: "img",
		attributes: ["src", "alt", "aspect"],
		events: [],
		flags: [],
	},
	Audio: {
		type: "audio",
		html: "audio",
		attributes: ["src"],
		events: ["play", "pause", "ended"],
		flags: ["controls"],
	},
	Video: {
		type: "video",
		html: "video",
		attributes: ["src", "aspect"],
		events: ["play", "pause", "ended"],
		flags: ["controls"],
	},
	Table: {
		type: "table",
		html: "table",
		attributes: ["columns", "rows"],
		events: [],
		flags: [],
	},
	Dialog: {
		type: "dialog",
		html: "dialog",
		attributes: [],
		events: ["close"],
		flags: ["open"],
	},
	/** Where a layout places the screen it wraps. Valid only in a layout. */
	Outlet: {
		type: "outlet",
		html: "slot",
		attributes: [],
		events: [],
		flags: [],
	},
};

/** Element attributes whose value is a data path or a call rather than
 * literal text. Everything else on an element is what it says. */
export const UI_DATA_ATTRIBUTES = new Set(["src", "options", "to"]);

// ─── References ──────────────────────────────────────────────────────────────

export type UiRef =
	| { kind: "component"; name: string }
	| { kind: "element"; module: string; name: string }
	| { kind: "unknown"; module: string; name: string };

// ─── Io ──────────────────────────────────────────────────────────────────────

export const UI_IO_MODES = ["loading", "error", "ready", "empty"] as const;
export type UiIoMode = (typeof UI_IO_MODES)[number];

/** `in ~band(id)`, `out ~signIn(email=#email.value)`. An `in` runs on entry
 * and again when an argument changes; an `out` runs when an action names
 * it. The name is the operation's; the data an `in` returns is addressed
 * by the same name without the sigil. */
export type UiIo = {
	kind: "in" | "out";
	name: string;
	args: Record<string, string>;
	/** `ready => go Search`: what happens on entering an io mode. */
	outcomes: UiOutcome[];
};

export type UiOutcome = { mode: UiIoMode; action: UiAction };

// ─── Actions and handlers ────────────────────────────────────────────────────

/** What follows `=>` after an event or an io mode. */
export type UiAction =
	| { kind: "mode"; mode: string; value?: string }
	| { kind: "emit"; event: string; value?: string }
	| { kind: "io"; name: string }
	| { kind: "go"; screen: string; args: Record<string, string> };

/** `$click => ~signIn`, `$open(picked) => go Band(id=picked.id)`: on an
 * element or instance line, or in an override. */
export type UiHandler = { event: string; param?: string; action: UiAction };

// ─── Conditions ──────────────────────────────────────────────────────────────

/** The left side of a `when` case. */
export type UiCondition =
	| { kind: "else" }
	/** In `when <subject>`: a value the subject is matched against. */
	| { kind: "value"; value: string }
	/** A data path, true when it holds a value. */
	| { kind: "path"; path: string }
	/** `~signIn.error`: an operation in one of its modes. */
	| { kind: "io"; name: string; mode: UiIoMode }
	/** `@shows`: the component is in that mode. */
	| { kind: "mode"; mode: string };

export type UiCase = {
	condition: UiCondition;
	/** A case in the tree yields tree lines… */
	nodes: UiNode[];
	/** …and a case at component level yields overrides. */
	overrides: UiOverride[];
};

// ─── Tree ────────────────────────────────────────────────────────────────────

/** One line of a tree: an element or component instance, a `list`, a
 * `modal`, or a `when`. */
export type UiNode = {
	/** Parser-assigned key, unique within the document. */
	key: string;
	kind: "instance" | "list" | "modal" | "when";
	/** As written: `Button`, `App.Nav`. Instances only. */
	name?: string;
	ref?: UiRef;
	content?: string;
	/** `#id` */
	id?: string;
	/** Bare words after the head, in order; become flags once the name
	 * resolves. */
	words: string[];
	/** `key=value` pairs; become attributes once the name resolves. */
	pairs: Record<string, string>;
	/** Component use: `Nav(current=Search)`, with `name` short for
	 * `name=name`. */
	args: Record<string, string>;
	attributes: Record<string, string>;
	flags: string[];
	/** `$click => ~signIn`, one per event the line handles. */
	handlers: UiHandler[];
	/** `list <data> as <item>` */
	data?: string;
	item?: string;
	/** `when [subject]` */
	subject?: string;
	cases?: UiCase[];
	children: UiNode[];
};

/** `#search selected`, `#nav @search`, `#audio $pause => @paused`: a
 * change to an instance the tree declares, in a component-level `when`. */
export type UiOverride = {
	handle: string;
	content?: string;
	attributes: Record<string, string>;
	flags: string[];
	mode?: { mode: string; value?: string };
	handlers: UiHandler[];
};

// ─── Components ──────────────────────────────────────────────────────────────

/** `@shows`, `@playing(current)`: declared on the header. */
export type UiMode = { name: string; param?: string };

export type UiComponent = {
	name: string;
	/** Present on screens. */
	route?: string;
	routeParams: string[];
	/** True for a `layout`: a component with one `Outlet` that wraps screens. */
	isLayout?: boolean;
	/** On a screen: the `layout=` it names, as written, and the arguments it
	 * passes. */
	layoutName?: string;
	layoutArgs: Record<string, string>;
	/** On a screen: the layout that wraps it, named or defaulted. Computed
	 * after parsing. */
	usesLayout?: string;
	params: string[];
	/** Declared on the header, in order. The first is where the component
	 * starts. */
	modes: UiMode[];
	io: UiIo[];
	/** The tree, as a sequence of lines. */
	tree: UiNode[];
	/** Component-level `when` nodes, whose cases hold overrides. */
	whens: UiNode[];
	/** Events this component emits, from `=> $event` actions anywhere in
	 * it; true when the event carries a value. Computed after parsing. */
	emits: Record<string, boolean>;
	/** Data names in scope throughout the component: params, route params,
	 * io names, document-level io. List items, mode params, and handler
	 * params are local to where they are declared. Computed after parsing. */
	scope: string[];
};

/** Rendering colors a document may set with `%%{theme ink=… accent=…}%%`.
 * `ink` is the interface's own color: frame borders, buttons, headings,
 * text. `accent` is the callout badges, kept distinct from the ink so a
 * badge never reads as part of the screen. */
export type UiTheme = { ink: string; accent: string };

export const UI_DEFAULT_THEME: UiTheme = { ink: "#1f2937", accent: "#3299f6" };

/** The numeral color for a badge: white on a dark accent, the ink on a
 * light one, by the accent's relative luminance. */
export function badgeInk(accent: string, ink: string): string {
	const hex = accent.replace("#", "");
	const full =
		hex.length === 3 || hex.length === 4
			? hex
					.slice(0, 3)
					.split("")
					.map((c) => c + c)
					.join("")
			: hex.slice(0, 6);
	const channel = (i: number) => {
		const v = Number.parseInt(full.slice(i, i + 2), 16) / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	const luminance =
		0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
	return luminance < 0.4 ? "#ffffff" : ink;
}

export type UiAST = DiagramAST & {
	type: "ui";
	/** From a `theme` directive; defaults fill what it leaves out. */
	theme?: Partial<UiTheme>;
	uses: UiImport[];
	apis: UiApi[];
	/** Document-level `in`: app data every component can read. */
	io: UiIo[];
	/** The screen whose route is `/`. Computed after parsing. */
	entry?: string;
	components: Record<string, UiComponent>;
	/** Declaration order. */
	order: string[];
};

// ─── Adapters ────────────────────────────────────────────────────────────────

export type UiSvgRenderContext = {
	ast: UiAST;
	node: UiNode;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	childrenSvg?: string;
};

export type UiAsciiRenderContext = { ast: UiAST; node: UiNode; label: string };

export type UiElementAdapter = {
	type?: UiRenderType;
	renderSvg?: (ctx: UiSvgRenderContext) => string;
	renderAscii?: (ctx: UiAsciiRenderContext) => string;
};

export type UiLibraryAdapter = {
	module: string;
	elements: Record<string, UiElementAdapter>;
};

// ─── Printing ────────────────────────────────────────────────────────────────

export function renderAction(action: UiAction): string {
	switch (action.kind) {
		case "mode":
			return `@${action.mode}${action.value !== undefined ? `(${action.value})` : ""}`;
		case "emit":
			return `$${action.event}${action.value !== undefined ? `(${action.value})` : ""}`;
		case "io":
			return `~${action.name}`;
		case "go": {
			const args = renderArgs(action.args);
			return `go ${action.screen}${args}`;
		}
	}
}

/** `(id=picked.id)`, with `name=name` printed as `name`; empty when there
 * are no arguments. */
export function renderArgs(args: Record<string, string>): string {
	const parts = Object.entries(args).map(([k, v]) =>
		k === v ? k : `${k}=${v}`,
	);
	return parts.length ? `(${parts.join(", ")})` : "";
}

export function renderCondition(c: UiCondition): string {
	switch (c.kind) {
		case "else":
			return "else";
		case "value":
			return c.value;
		case "path":
			return c.path;
		case "io":
			return `~${c.name}.${c.mode}`;
		case "mode":
			return `@${c.mode}`;
	}
}

export function renderHandler(h: UiHandler): string {
	return `$${h.event}${h.param ? `(${h.param})` : ""} => ${renderAction(h.action)}`;
}
