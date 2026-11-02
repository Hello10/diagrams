import { FONT_MONO } from "../../style.ts";
import { arrowMarker, svgEsc } from "../../svg.ts";
import { interpolations, isDataPath, parseCall } from "./UiParser.ts";
import { getUiLibraryAdapter } from "./uiAdapters.ts";
import {
	badgeInk,
	UI_DEFAULT_THEME,
	UI_STANDARD_ELEMENTS,
	type UiAST,
	type UiCase,
	type UiComponent,
	type UiCondition,
	type UiElementAdapter,
	type UiHandler,
	type UiIoMode,
	type UiNode,
	type UiOverride,
	type UiRenderType,
	type UiTheme,
} from "./uiTypes.ts";

/**
 * One frame: a component in one view, expanded into a layout tree
 * (components expanded, `when` cases decided, overrides applied, lists
 * unrolled, modals lifted, a screen wrapped in its layout), measured with
 * Stack semantics, and drawn. The storyboard composes frames; the flow
 * renderer scales them into thumbnails; the text rendering walks the same
 * tree.
 */
export const SPACE: Record<string, number> = {
	none: 0,
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
	xxl: 32,
};
export const DEFAULT_GAP = SPACE.md ?? 12;
export const FONT: Record<string, number> = {
	xs: 11,
	sm: 12,
	md: 14,
	lg: 18,
	xl: 24,
	xxl: 32,
};
export const LINE_HEIGHT = 1.4;

export const CONTROL_HEIGHT = 36;
export const CONTROL_RADIUS = 0;
export const CHOICE_SIZE = 16;
export const SPINNER_R = 6;
export const FIELD_LABEL_HEIGHT = 18;

export const SCREEN_WIDTH = 390;
export const COMPONENT_WIDTH = 320;
export const FRAME_PADDING = 16;
export const FRAME_MIN_HEIGHT = 200;
export const FRAME_RADIUS = 0;
export const FRAME_GAP = 40;
export const SECTION_GAP = 56;
export const CAPTION_HEIGHT = 26;
export const CANVAS_PAD = 40;
export const MODAL_MAX_WIDTH = 400;
export const MODAL_MARGIN = 24;
export const MODAL_PADDING = 16;
export const REPEAT_COUNT = 3;
export const SECTION_HEADING_H = 32;
export const TIER_HEADING_H = 48;
export const TIER_GAP = 72;
export const GRAPH_GAP = 24;
export const BADGE_R = 8;
export const EXIT_LINE_H = 22;

export const INK = "#1f2937";
export const INK_SOFT = "#4b5563";
export const MUTED = "#9ca3af";
export const LINE = "#d1d5db";
export const SURFACE = "#f3f4f6";
export const WHITE = "#ffffff";
export const DIM = "rgba(17, 24, 39, 0.45)";
/** Opacity of a screen's layout in the screen's frame. */
export const CHROME_OPACITY = 0.4;
/** The dashed slot outline around a screen's content in its layout: how far
 * outside the content it sits, and how faint it is. */
export const OUTLET_INSET = 5;
export const OUTLET_OPACITY = 0.5;

/** Clip-path ids must be unique per document; the flow renderer embeds
 * frames from this one, so the counter is module-level. */

// ─── Views ───────────────────────────────────────────────────────────────────

/** One appearance of a component: the authored mode it is in, and, for
 * frames that show an operation in a mode other than its resting one, which
 * operation and which mode. */
export type UiView = {
	mode?: string;
	io?: { name: string; mode: UiIoMode };
};

/** The frames a component gets: one per declared mode (or one, when it
 * declares none), then one for every io condition its tree names, drawn in
 * the mode that condition sits in. An `in` is `ready` at rest, so
 * `~x.ready` on an `in` adds nothing. */
export function frameViews(component: UiComponent, ast: UiAST): UiView[] {
	const modes = component.modes.map((m) => m.name);
	const start = modes[0];
	const views: UiView[] = modes.length ? modes.map((mode) => ({ mode })) : [{}];
	const seen = new Set<string>();
	const ioKind = (name: string) =>
		component.io.find((io) => io.name === name)?.kind ??
		ast.io.find((io) => io.name === name)?.kind;
	const add = (c: UiCondition, mode: string | undefined) => {
		if (c.kind !== "io") return;
		if (c.mode === "ready" && ioKind(c.name) === "in") return;
		const key = `${mode ?? ""}|${c.name}.${c.mode}`;
		if (seen.has(key)) return;
		seen.add(key);
		views.push({ mode, io: { name: c.name, mode: c.mode } });
	};
	const visit = (nodes: UiNode[], mode: string | undefined) => {
		for (const node of nodes) {
			if (node.kind === "when") {
				for (const kase of node.cases ?? []) {
					add(kase.condition, mode);
					const inner =
						kase.condition.kind === "mode" ? kase.condition.mode : mode;
					visit(kase.nodes, inner);
				}
				continue;
			}
			visit(node.children, mode);
		}
	};
	visit(component.tree, start);
	for (const when of component.whens) {
		for (const kase of when.cases ?? []) add(kase.condition, start);
	}
	return views;
}

/** The caption a frame gets: `@shows`, `~band.loading`, or both. */
export function viewLabel(view: UiView): string {
	const parts: string[] = [];
	if (view.mode !== undefined) parts.push(`@${view.mode}`);
	if (view.io) parts.push(`~${view.io.name}.${view.io.mode}`);
	return parts.join(" ");
}

export function sameView(a: UiView, b: UiView): boolean {
	return viewLabel(a) === viewLabel(b);
}

// ─── Layout tree ─────────────────────────────────────────────────────────────

export type Sizing =
	| { kind: "fill" }
	| { kind: "hug" }
	| { kind: "fixed"; px: number };
export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "between";
export type Direction = "row" | "column";
export type LKind = UiRenderType | "box" | "custom";

/** A node of the expanded layout tree: components expanded, overrides
 * applied, lists unrolled, modals lifted out. Both the SVG and the text
 * renderers walk this tree. */
export interface LNode {
	kind: LKind;
	source: UiNode;
	/** The element or component name as written. */
	name?: string;
	id?: string;
	/** Effective content, or the data path when the node shows data. */
	label: string;
	/** True when `label` is a data path standing in for a value. */
	placeholder: boolean;
	props: Record<string, string>;
	flags: Set<string>;
	/** True when the element fires nothing in this view (see
	 * `UiElementContract.inert`); a person cannot act on it. */
	inert?: boolean;
	/** Handlers in effect, from the line and from overrides. On the root of
	 * an expanded component instance these are the instance's. */
	handlers: UiHandler[];
	/** Set on the root of an expanded component instance: its name, and
	 * the handlers the component's own root line declares. */
	component?: string;
	ownHandlers?: UiHandler[];
	/** True when the node belongs to the layout a screen is drawn in, not
	 * to the screen. Drawn dimmed, and its actions are the layout's. */
	chrome?: boolean;
	/** True on the screen's own content where it fills its layout's Outlet;
	 * outlined faintly so the slot stays visible. */
	outlet?: boolean;
	data?: string;
	children: LNode[];
	direction: Direction;
	gap: number;
	padding: number;
	align: Align;
	justify: Justify;
	width?: Sizing;
	height?: Sizing;
	/** Display name for `box` and `custom` nodes. */
	title: string;
	adapter?: UiElementAdapter;
	repeatCount?: number;
	repeatItem?: LNode;
}

export interface BuildContext {
	/** The component whose tree is being built, and the view it is in. */
	component: UiComponent;
	view: UiView;
	/** Overrides by handle, from the component-level `when` cases that hold
	 * in this view. */
	overrides: Map<string, UiOverride[]>;
	/** Parameter → the expression the parent bound it to, so placeholders
	 * inside an embedded component show the data that actually flows in,
	 * and `when <subject>` can match a bound value. */
	bindings: Map<string, string>;
	/** Components being expanded, to stop recursion. */
	trail: Set<string>;
	/** Modals met while building; drawn as overlays. */
	modals: LNode[];
	/** When building a layout around a screen: what its Outlet becomes. */
	outlet?: LNode;
	/** True while building the layout around a screen. */
	chrome: boolean;
}

export interface Size {
	w: number;
	h: number;
}

export interface Frame {
	component: UiComponent;
	view: UiView;
	width: number;
	content: LNode;
	modals: LNode[];
	contentHeight: number;
	height: number;
}

let clipCounter = 0;

// ─── Renderer ────────────────────────────────────────────────────────────────

export class UiFrameEngine {
	readonly ast: UiAST;
	readonly theme: UiTheme;
	/** The interface's own color, from the theme. */
	private readonly ink: string;

	constructor(ast: UiAST) {
		this.ast = ast;
		this.theme = { ...UI_DEFAULT_THEME, ...ast.theme };
		this.ink = this.theme.ink;
	}

	frameDefs(): string {
		return `${arrowMarker("ui-arr", this.ink)}${arrowMarker("state-arr")}<filter id="ui-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#111827" flood-opacity="0.25"/></filter>`;
	}

	/** One component in one view, drawn at the origin without a caption.
	 * Used by the flow renderer for thumbnails. */
	renderFrame(
		name: string,
		view?: UiView,
	): { svg: string; width: number; height: number } | undefined {
		const component = this.ast.components[name];
		if (!component) return undefined;
		const width =
			component.route !== undefined || component.isLayout
				? SCREEN_WIDTH
				: COMPONENT_WIDTH;
		const frame = this.buildFrame(
			component,
			view ?? frameViews(component, this.ast)[0] ?? {},
			width,
		);
		return {
			svg: this.drawFrameBody(frame, 0, 0),
			width,
			height: frame.height,
		};
	}

	buildFrame(component: UiComponent, view: UiView, width: number): Frame {
		const ctx = this.context(component, view, new Map(), new Set(), [], false);
		const own = this.syntheticStack(
			this.buildMany(component.tree, ctx),
			"column",
			DEFAULT_GAP,
		);
		// A screen draws inside its layout, in the layout's Outlet, passing
		// the layout the arguments named on `layout=`.
		const layout =
			component.usesLayout !== undefined
				? this.ast.components[component.usesLayout]
				: undefined;
		let content = own;
		if (layout) {
			const bindings = new Map<string, string>();
			for (const [k, v] of Object.entries(component.layoutArgs))
				bindings.set(k, v);
			const wrap = this.context(
				layout,
				{ mode: layout.modes[0]?.name },
				bindings,
				new Set([component.name]),
				ctx.modals,
				true,
			);
			wrap.outlet = own;
			content = this.syntheticStack(
				this.buildMany(layout.tree, wrap),
				"column",
				DEFAULT_GAP,
			);
		}
		const innerW = width - FRAME_PADDING * 2;
		const contentHeight = this.measure(content, innerW, "fill").h;
		let height = Math.max(
			contentHeight + FRAME_PADDING * 2,
			component.route !== undefined ? FRAME_MIN_HEIGHT : 0,
		);
		for (const modal of ctx.modals) {
			const box = this.modalBox(modal, width);
			height = Math.max(height, box.h + MODAL_MARGIN * 2 + FRAME_PADDING * 2);
		}
		return {
			component,
			view,
			width,
			content,
			modals: ctx.modals,
			contentHeight,
			height,
		};
	}

	private context(
		component: UiComponent,
		view: UiView,
		bindings: Map<string, string>,
		trail: Set<string>,
		modals: LNode[],
		chrome: boolean,
	): BuildContext {
		const ctx: BuildContext = {
			component,
			view,
			overrides: new Map(),
			bindings,
			trail: new Set([...trail, component.name]),
			modals,
			chrome,
		};
		ctx.overrides = this.overridesFor(ctx);
		return ctx;
	}

	// ─── Storyboard ────────────────────────────────────────────────────────────

	drawFrameBody(frame: Frame, x: number, fy: number): string {
		const parts: string[] = [];
		const fw = frame.width;
		const fh = frame.height;
		const clipId = `ui-clip-${clipCounter++}`;
		const label = viewLabel(frame.view);
		parts.push(
			`<g data-frame="${svgEsc(frame.component.name)}"${label ? ` data-view="${svgEsc(label)}"` : ""}>`,
			`<rect x="${x}" y="${fy}" width="${fw}" height="${fh}" rx="${FRAME_RADIUS}" fill="${WHITE}" stroke="${this.ink}" stroke-width="1.5"/>`,
			`<clipPath id="${clipId}"><rect x="${x}" y="${fy}" width="${fw}" height="${fh}" rx="${FRAME_RADIUS}"/></clipPath>`,
			`<g clip-path="url(#${clipId})">`,
			this.draw(
				frame.content,
				x + FRAME_PADDING,
				fy + FRAME_PADDING,
				fw - FRAME_PADDING * 2,
				frame.contentHeight,
			),
		);
		for (const modal of frame.modals) {
			const box = this.modalBox(modal, fw);
			const mx = x + (fw - box.w) / 2;
			const my = fy + Math.max(MODAL_MARGIN, (fh - box.h) / 2);
			parts.push(
				`<rect x="${x}" y="${fy}" width="${fw}" height="${fh}" fill="${DIM}"/>`,
				`<g filter="url(#ui-shadow)"><rect x="${mx}" y="${my}" width="${box.w}" height="${box.h}" rx="${CONTROL_RADIUS}" fill="${WHITE}"/></g>`,
				this.draw(
					modal,
					mx + MODAL_PADDING,
					my + MODAL_PADDING,
					box.innerW,
					box.innerH,
				),
			);
		}
		parts.push("</g>", "</g>");
		return parts.join("\n");
	}

	/** A modal's box inside a frame of width `fw`: capped in width, padded
	 * like the frame, as tall as its content. */
	private modalBox(
		modal: LNode,
		fw: number,
	): { w: number; h: number; innerW: number; innerH: number } {
		const w = Math.min(MODAL_MAX_WIDTH, fw - MODAL_MARGIN * 2);
		const innerW = w - MODAL_PADDING * 2;
		const innerH = this.measure(modal, innerW, "fill").h;
		return { w, h: innerH + MODAL_PADDING * 2, innerW, innerH };
	}

	// ─── Conditions ────────────────────────────────────────────────────────────

	/** Does a `when` case hold in this view? Modes and io modes are decided
	 * by the view; an `in` is ready at rest and an `out` is idle. A subject
	 * matches a value when the subject is bound to it. A bare data path
	 * cannot be known from a diagram and is false, so `else` branches show. */
	holds(c: UiCondition, ctx: BuildContext, subject?: string): boolean {
		switch (c.kind) {
			case "else":
				return true;
			case "mode":
				return ctx.view.mode === c.mode;
			case "io": {
				if (ctx.view.io?.name === c.name) return ctx.view.io.mode === c.mode;
				const kind =
					ctx.component.io.find((io) => io.name === c.name)?.kind ??
					this.ast.io.find((io) => io.name === c.name)?.kind;
				return kind === "in" && c.mode === "ready";
			}
			case "path":
				return false;
			case "value": {
				if (subject === undefined) return false;
				const bound = this.substitute(subject, ctx.bindings);
				return bound !== subject && bound === c.value;
			}
		}
	}

	/** The case of a `when` that holds, if any. */
	private chosenCase(node: UiNode, ctx: BuildContext): UiCase | undefined {
		return (node.cases ?? []).find((k) =>
			this.holds(k.condition, ctx, node.subject),
		);
	}

	/** Overrides in effect: from every component-level `when`, the first
	 * case that holds. */
	private overridesFor(ctx: BuildContext): Map<string, UiOverride[]> {
		const out = new Map<string, UiOverride[]>();
		for (const when of ctx.component.whens) {
			const kase = this.chosenCase(when, ctx);
			for (const o of kase?.overrides ?? []) {
				const list = out.get(o.handle) ?? [];
				list.push(o);
				out.set(o.handle, list);
			}
		}
		return out;
	}

	/** Is data named by `head` in hand in this view? Not while the `in`
	 * that supplies it is loading, failed, or empty. */
	private inHand(head: string, ctx: BuildContext): boolean {
		const io = ctx.view.io;
		return !(io && io.name === head && io.mode !== "ready");
	}

	// ─── Build: AST → layout tree ──────────────────────────────────────────────

	/** Build a sequence of tree lines. A `when` contributes the lines of its
	 * chosen case, inline. */
	private buildMany(nodes: UiNode[], ctx: BuildContext): LNode[] {
		const out: LNode[] = [];
		for (const node of nodes) {
			if (node.kind === "when") {
				const kase = this.chosenCase(node, ctx);
				if (kase) out.push(...this.buildMany(kase.nodes, ctx));
				continue;
			}
			const built = this.build(node, ctx);
			if (built) out.push(built);
		}
		return out;
	}

	private build(node: UiNode, ctx: BuildContext): LNode | undefined {
		if (node.kind === "modal") {
			const children = this.buildMany(node.children, ctx);
			const modal =
				children.length === 1 && children[0]
					? children[0]
					: this.syntheticStack(children, "column", DEFAULT_GAP, node);
			ctx.modals.push(modal);
			return undefined;
		}

		if (node.kind === "list") {
			const head = (node.data ?? "").split(".")[0] ?? "";
			if (!this.inHand(head, ctx)) return undefined;
			const eff = this.effective(node, ctx);
			const children = this.buildMany(node.children, ctx);
			if (children.length === 0) return undefined;
			const item =
				children.length === 1 && children[0]
					? children[0]
					: this.syntheticStack(children, "column", DEFAULT_GAP, node);
			const stack = this.baseNode("stack", node, eff);
			if (ctx.chrome) stack.chrome = true;
			stack.direction = eff.attributes.direction === "row" ? "row" : "column";
			stack.children = Array.from({ length: REPEAT_COUNT }, () => item);
			stack.repeatCount = REPEAT_COUNT;
			stack.repeatItem = item;
			return stack;
		}

		const eff = this.effective(node, ctx);
		if (eff.flags.has("hidden")) return undefined;
		if (!eff.available) return undefined;

		if (node.ref?.kind === "component")
			return this.expand(node.ref.name, node, eff, ctx);

		// A layout's Outlet is the screen being wrapped, when there is one.
		if (
			node.ref?.kind === "element" &&
			node.ref.name === "Outlet" &&
			ctx.outlet
		) {
			ctx.outlet.outlet = true;
			return ctx.outlet;
		}

		const adapter = this.adapterFor(node);
		const kind: LKind = adapter?.renderSvg
			? "custom"
			: (adapter?.type ?? "box");
		const lnode = this.baseNode(kind, node, eff);
		if (ctx.chrome) lnode.chrome = true;
		lnode.adapter = adapter;
		const contract =
			node.ref?.kind === "element"
				? UI_STANDARD_ELEMENTS[node.ref.name]
				: undefined;
		lnode.inert = (contract?.inert ?? []).some((f) => eff.flags.has(f));
		lnode.children = this.buildMany(node.children, ctx);
		return lnode;
	}

	/** A component instance draws as its tree in the mode the parent set
	 * (`#nav @search`) or its start mode, with its arguments bound. */
	private expand(
		name: string,
		use: UiNode,
		eff: Effective,
		ctx: BuildContext,
	): LNode {
		const component = this.ast.components[name];
		if (!component || component.tree.length === 0 || ctx.trail.has(name)) {
			const box = this.boxNode(use, eff);
			box.title = ctx.trail.has(name) ? `${name} (recursive)` : name;
			return box;
		}
		const bindings = new Map<string, string>();
		for (const [param, value] of Object.entries(use.args))
			bindings.set(param, this.substitute(value, ctx.bindings));
		const inner = this.context(
			component,
			{ mode: eff.mode ?? component.modes[0]?.name },
			bindings,
			ctx.trail,
			ctx.modals,
			ctx.chrome,
		);
		const built = this.buildMany(component.tree, inner);
		// A lone element is the root itself. A lone instance is not reused:
		// it already carries its own component's handlers, and this level's
		// go on a node of their own so an emit traces through both.
		const only = built.length === 1 ? built[0] : undefined;
		const root =
			only && !only.component
				? only
				: this.syntheticStack(built, "column", DEFAULT_GAP, use);
		if (ctx.chrome) root.chrome = true;
		root.component = name;
		root.name = name;
		if (use.id) root.id = use.id;
		for (const flag of eff.flags) root.flags.add(flag);
		root.ownHandlers = root.handlers;
		root.handlers = eff.handlers;
		return root;
	}

	/** A handler with the parent's bindings substituted into its action, so
	 * a callout inside an embedded component reads in the parent's terms:
	 * `go Detail(id=featured.id)`. */
	private bindHandler(h: UiHandler, ctx: BuildContext): UiHandler {
		const sub = (v: string) => this.substitute(v, ctx.bindings);
		const a = h.action;
		let action: UiHandler["action"];
		switch (a.kind) {
			case "go":
				action = {
					...a,
					args: Object.fromEntries(
						Object.entries(a.args).map(([k, v]) => [k, sub(v)]),
					),
				};
				break;
			case "mode":
			case "emit":
				action = a.value === undefined ? a : { ...a, value: sub(a.value) };
				break;
			default:
				action = a;
		}
		return { ...h, action };
	}

	/** `show.title` with `show` bound to `featured` → `featured.title`. */
	private substitute(value: string, bindings: Map<string, string>): string {
		const dot = value.indexOf(".");
		const head = dot === -1 ? value : value.slice(0, dot);
		const bound = bindings.get(head);
		if (bound === undefined) return value;
		return dot === -1 ? bound : `${bound}${value.slice(dot)}`;
	}

	private boxNode(node: UiNode, eff: Effective): LNode {
		return this.baseNode("box", node, eff);
	}

	private baseNode(kind: LKind, node: UiNode, eff: Effective): LNode {
		return {
			kind,
			source: node,
			name: node.name,
			id: node.id,
			label: eff.label,
			placeholder: eff.placeholder,
			props: eff.attributes,
			flags: eff.flags,
			handlers: eff.handlers,
			data: eff.data,
			children: [],
			direction: eff.attributes.direction === "row" ? "row" : "column",
			gap: DEFAULT_GAP,
			padding: 0,
			align: eff.attributes.direction === "row" ? "center" : "stretch",
			justify: "start",
			title: node.name ?? node.kind,
		};
	}

	private syntheticStack(
		children: LNode[],
		direction: Direction,
		gap: number,
		source?: UiNode,
	): LNode {
		return {
			kind: "stack",
			source: source ?? {
				key: "__synthetic__",
				kind: "instance",
				words: [],
				pairs: {},
				args: {},
				attributes: {},
				flags: [],
				handlers: [],
				children: [],
			},
			label: "",
			placeholder: false,
			props: {},
			flags: new Set(),
			handlers: [],
			children,
			direction,
			gap,
			padding: 0,
			align: direction === "row" ? "center" : "stretch",
			justify: "start",
			title: "Stack",
		};
	}

	/** The node's own declaration with the view's overrides applied, its
	 * content interpolated, and whether the data it shows is in hand. */
	private effective(node: UiNode, ctx: BuildContext): Effective {
		const attributes: Record<string, string> = { ...node.attributes };
		const flags = new Set(node.flags);
		const handlers = node.handlers.map((h) => this.bindHandler(h, ctx));
		let content = node.content;
		let mode: string | undefined;
		for (const o of node.id ? (ctx.overrides.get(node.id) ?? []) : []) {
			if (o.content !== undefined) content = o.content;
			Object.assign(attributes, o.attributes);
			for (const f of o.flags) flags.add(f);
			if (o.mode) mode = o.mode.mode;
			// `#play $click => @stopped` in a view replaces the element's own
			// click; one event has one action.
			for (const h of o.handlers) {
				const bound = this.bindHandler(h, ctx);
				const at = handlers.findIndex((x) => x.event === bound.event);
				if (at === -1) handlers.push(bound);
				else handlers[at] = bound;
			}
		}
		// Every data path the node depends on: interpolations in its content,
		// data attributes, a data-path value, and a component's arguments.
		const heads: string[] = [];
		const paths = content !== undefined ? interpolations(content) : [];
		for (const key of ["src", "options"]) {
			const v = attributes[key];
			if (v !== undefined) paths.push(v);
		}
		const value = attributes.value;
		if (value !== undefined && isDataPath(value)) paths.push(value);
		for (const v of Object.values(node.args)) paths.push(v);
		for (const p of paths) if (!isQuoted(p)) heads.push(p.split(".")[0] ?? p);
		const available = heads.every((h) => this.inHand(h, ctx));

		// Content: a literal, or `{path}` standing in for a value. A whole
		// interpolation is a placeholder; a mixed string keeps its braces.
		let label = "";
		let placeholder = false;
		let data: string | undefined;
		if (content !== undefined) {
			// An argument given as quoted text (`Card(title="Hello")`) is
			// that text: `{title}` shows Hello, not a placeholder.
			const whole = /^\{([^}]+)\}$/.exec(content.trim());
			const bound = (p: string) => this.substitute(p.trim(), ctx.bindings);
			if (whole) {
				const v = bound(whole[1] ?? "");
				if (isQuoted(v)) label = v.slice(1, -1);
				else {
					data = v;
					label = `{${data}}`;
					placeholder = true;
				}
			} else {
				label = content.replace(/\{([^}]+)\}/g, (_, p: string) => {
					const v = bound(p);
					return isQuoted(v) ? v.slice(1, -1) : `{${v}}`;
				});
			}
		} else if (value !== undefined) {
			if (isDataPath(value)) {
				data = this.substitute(value, ctx.bindings);
				label = `{${data}}`;
				placeholder = true;
			} else {
				label = value;
			}
		} else if (attributes.src !== undefined) {
			data = this.substitute(attributes.src, ctx.bindings);
			label = `{${data}}`;
			placeholder = true;
		}
		// A link's `to=` is a screen call; its label is its content.
		const to = attributes.to;
		if (to !== undefined) {
			const call = parseCall(to);
			if (call)
				attributes.to = `${call.name}${call.args ? `(${call.args})` : ""}`;
		}
		return {
			label,
			placeholder,
			attributes,
			flags,
			handlers,
			available,
			...(data !== undefined ? { data } : {}),
			...(mode !== undefined ? { mode } : {}),
		};
	}

	private adapterFor(node: UiNode): UiElementAdapter | undefined {
		const ref = node.ref;
		if (!ref || ref.kind === "component") return undefined;
		const adapter = getUiLibraryAdapter(ref.module)?.elements[ref.name];
		if (adapter) return adapter;
		const contract = UI_STANDARD_ELEMENTS[ref.name];
		return ref.kind === "element" && contract
			? { type: contract.type }
			: undefined;
	}

	// ─── Measure ───────────────────────────────────────────────────────────────

	/** Size the node takes when offered `availW`. `auto` is what the parent
	 * wants for a child that declares no width. Height is natural unless
	 * fixed; a parent distributes `fill` heights itself. */
	measure(n: LNode, availW: number, auto: "fill" | "hug"): Size {
		const w = this.resolveWidth(n, availW, auto);
		const h =
			n.height?.kind === "fixed" ? n.height.px : this.naturalHeight(n, w);
		return { w, h };
	}

	private resolveWidth(n: LNode, availW: number, auto: "fill" | "hug"): number {
		const sizing = n.width ?? { kind: auto };
		switch (sizing.kind) {
			case "fill":
				return availW;
			case "fixed":
				return Math.min(sizing.px, availW);
			case "hug":
				return Math.min(this.naturalWidth(n, availW), availW);
		}
	}

	/** Which way a child with no declared width goes inside a row: containers
	 * and fields fill, controls and media hug. */
	private rowAuto(child: LNode): "fill" | "hug" {
		switch (child.kind) {
			case "stack":
			case "outlet":
			case "box":
			case "custom":
			case "table":
			case "dialog":
			case "input":
			case "select":
				return "fill";
			default:
				return "hug";
		}
	}

	private columnAuto(n: LNode): "fill" | "hug" {
		return n.align === "stretch" ? "fill" : "hug";
	}

	private naturalWidth(n: LNode, availW: number): number {
		const size = this.fontSize(n);
		switch (n.kind) {
			case "text":
			case "heading":
			case "link":
				return Math.ceil(
					this.textWidth(n.label || " ", size, this.fontWeight(n)),
				);
			case "button":
				return Math.ceil(this.textWidth(n.label || "Button", size, 600)) + 32;
			case "input":
			case "select":
				return Math.min(220, availW);
			case "checkbox":
			case "radio":
				return (
					CHOICE_SIZE + 8 + Math.ceil(this.textWidth(n.label || "Option", size))
				);
			case "image":
				return Math.min(80, availW);
			case "video":
			case "audio":
				return Math.min(240, availW);
			case "table":
				return Math.min(
					Math.max(this.tableColumns(n).length * 110, 240),
					availW,
				);
			case "dialog":
				return Math.min(360, availW);
			case "outlet":
			case "box":
			case "custom": {
				const labelW = this.textWidth(this.boxLabel(n), FONT.xs ?? 11) + 24;
				if (n.children.length === 0) return Math.max(labelW, 96);
				return Math.min(
					Math.max(labelW, this.stackNaturalWidth(n, availW, 12)),
					availW,
				);
			}
			case "stack":
				return this.stackNaturalWidth(n, availW, n.padding);
		}
	}

	private stackNaturalWidth(n: LNode, availW: number, padding: number): number {
		const innerAvail = Math.max(availW - padding * 2, 0);
		if (n.direction === "row") {
			let total = 0;
			for (const child of n.children) {
				total += this.resolveWidth(child, innerAvail, "hug");
			}
			total += Math.max(n.children.length - 1, 0) * n.gap;
			return total + padding * 2;
		}
		let max = 0;
		for (const child of n.children) {
			max = Math.max(max, this.resolveWidth(child, innerAvail, "hug"));
		}
		return max + padding * 2;
	}

	private naturalHeight(n: LNode, w: number): number {
		const size = this.fontSize(n);
		switch (n.kind) {
			case "text":
			case "heading":
			case "link": {
				const lines = this.wrap(n.label || " ", w, size, this.fontWeight(n));
				return Math.ceil(lines.length * size * LINE_HEIGHT);
			}
			case "button":
				return CONTROL_HEIGHT;
			case "input":
			case "select":
				return CONTROL_HEIGHT + (n.props.label ? FIELD_LABEL_HEIGHT : 0);
			case "checkbox":
			case "radio":
				return Math.max(CHOICE_SIZE + 4, Math.ceil(size * LINE_HEIGHT));
			case "image":
				return Math.max(Math.round(w / this.aspect(n, 4 / 3)), 40);
			case "video":
				return Math.max(Math.round(w / this.aspect(n, 16 / 9)), 40);
			case "audio":
				return 40;
			case "table": {
				if (n.children.length > 0) {
					const rows = this.columnSizes(
						n.children,
						w - 2,
						undefined,
						SPACE.sm ?? 8,
						"fill",
					);
					return CONTROL_HEIGHT + rows.total + 16;
				}
				return CONTROL_HEIGHT + this.tableRows(n) * 32;
			}
			case "dialog": {
				const pad = SPACE.lg ?? 16;
				const innerW = w - pad * 2;
				const titleH = n.label
					? Math.ceil((FONT.lg ?? 18) * LINE_HEIGHT) + (SPACE.md ?? 12)
					: 0;
				const body = this.columnSizes(
					n.children,
					innerW,
					undefined,
					DEFAULT_GAP,
					"fill",
				);
				return pad * 2 + titleH + body.total;
			}
			case "outlet":
			case "box":
			case "custom": {
				// An Outlet with nothing in it is the slot a screen fills: tall
				// enough to read as one.
				if (n.children.length === 0) return n.kind === "outlet" ? 160 : 48;
				const pad = 12;
				const body = this.columnSizes(
					n.children,
					w - pad * 2,
					undefined,
					DEFAULT_GAP,
					"fill",
				);
				return Math.max(pad * 2 + 16 + body.total, 56);
			}
			case "stack": {
				const innerW = w - n.padding * 2;
				if (n.direction === "row") {
					return n.padding * 2 + this.rowLines(n, innerW).height;
				}
				const col = this.columnSizes(
					n.children,
					innerW,
					undefined,
					n.gap,
					this.columnAuto(n),
				);
				return n.padding * 2 + col.total;
			}
		}
	}

	/** Sizes of children stacked vertically. When `innerH` is known, children
	 * with `height=fill` share the leftover. */
	private columnSizes(
		children: LNode[],
		innerW: number,
		innerH: number | undefined,
		gap: number,
		auto: "fill" | "hug",
	): { sizes: Size[]; total: number } {
		const sizes = children.map((child) => this.measure(child, innerW, auto));
		const gaps = Math.max(children.length - 1, 0) * gap;
		let total = sizes.reduce((sum, s) => sum + s.h, 0) + gaps;
		if (innerH !== undefined) {
			const fillers = children
				.map((child, i) => (child.height?.kind === "fill" ? i : -1))
				.filter((i) => i >= 0);
			if (fillers.length > 0) {
				const fixed = sizes.reduce(
					(sum, s, i) => (fillers.includes(i) ? sum : sum + s.h),
					0,
				);
				const share = Math.max((innerH - fixed - gaps) / fillers.length, 0);
				for (const i of fillers) {
					const s = sizes[i];
					if (s) s.h = share;
				}
				total = innerH;
			}
		}
		return { sizes, total };
	}

	/** Children laid side by side, wrapped onto further lines when they do
	 * not fit, so nothing is squeezed: each item keeps its natural width,
	 * and a row that overflows grows down instead. Fill children (fields,
	 * nested stacks) take a minimum when packing and share the leftover of
	 * their line. A single item wider than the row gets the whole row. */
	private rowLines(n: LNode, innerW: number): RowLines {
		const children = n.children;
		const packed: number[] = [];
		const fill: boolean[] = [];
		children.forEach((child, i) => {
			const sizing = child.width ?? { kind: this.rowAuto(child) };
			fill[i] = sizing.kind === "fill";
			packed[i] = fill[i]
				? ROW_FILL_MIN_W
				: this.resolveWidth(child, innerW, "hug");
		});
		const lines: RowLine[] = [];
		let current: number[] = [];
		let used = 0;
		children.forEach((_, i) => {
			const w = packed[i] ?? 0;
			const need = used + (current.length ? n.gap : 0) + w;
			if (current.length > 0 && need > innerW + 0.5) {
				lines.push({ items: current, sizes: [], h: 0, totalW: 0 });
				current = [];
				used = 0;
			}
			current.push(i);
			used += (current.length > 1 ? n.gap : 0) + w;
		});
		if (current.length > 0)
			lines.push({ items: current, sizes: [], h: 0, totalW: 0 });

		for (const line of lines) {
			const gaps = Math.max(line.items.length - 1, 0) * n.gap;
			const fillers = line.items.filter((i) => fill[i]);
			const hugW = line.items
				.filter((i) => !fill[i])
				.reduce((sum, i) => sum + (packed[i] ?? 0), 0);
			const widths = new Map<number, number>();
			for (const i of line.items) {
				if (fill[i]) continue;
				widths.set(i, Math.min(packed[i] ?? 0, innerW));
			}
			if (fillers.length > 0) {
				const share = Math.max(
					(innerW - hugW - gaps) / fillers.length,
					ROW_FILL_MIN_W,
				);
				for (const i of fillers) widths.set(i, share);
			}
			line.sizes = line.items.map((i) => {
				const child = children[i] as LNode;
				const w = widths.get(i) ?? 0;
				const h =
					child.height?.kind === "fixed"
						? child.height.px
						: this.naturalHeight(child, w);
				return { w, h };
			});
			line.h = line.sizes.reduce((m, s) => Math.max(m, s.h), 0);
			line.totalW = line.sizes.reduce((sum, s) => sum + s.w, 0) + gaps;
		}
		const height =
			lines.reduce((sum, l) => sum + l.h, 0) +
			Math.max(lines.length - 1, 0) * n.gap;
		return { lines, height };
	}

	// ─── Draw ──────────────────────────────────────────────────────────────────

	draw(n: LNode, x: number, y: number, w: number, h: number): string {
		// A screen's layout is drawn dimmed, so the screen reads as the
		// subject. Dimming applies once, at the top of each run of layout
		// nodes that holds nothing of the screen.
		if (n.chrome && !this.inChrome && allChrome(n)) {
			this.inChrome = true;
			const out = this.draw(n, x, y, w, h);
			this.inChrome = false;
			return `<g data-chrome="true" opacity="${CHROME_OPACITY}">\n${out}\n</g>`;
		}
		let inner = this.drawNode(n, x, y, w, h);
		// The slot the screen fills in its layout: the same dashed edge the
		// layout's empty Outlet has, faint, just outside the content.
		if (n.outlet) {
			const pad = OUTLET_INSET;
			inner = `<rect x="${round(x - pad)}" y="${round(y - pad)}" width="${round(w + pad * 2)}" height="${round(h + pad * 2)}" fill="none" stroke="${MUTED}" stroke-dasharray="4,3" opacity="${OUTLET_OPACITY}"/>\n${inner}`;
		}
		const attrs: string[] = [];
		if (n.id) attrs.push(`data-id="${svgEsc(n.id)}"`);
		if (n.name) attrs.push(`data-component="${svgEsc(n.name)}"`);
		if (n.data) attrs.push(`data-ref="${svgEsc(n.data)}"`);
		if (n.flags.has("disabled")) attrs.push(`opacity="0.45"`);
		// A callout marks the element that fires the transition, once: a
		// repeated element gets the badge on its first copy only.
		const number = this.activeCallouts.get(n);
		if (number !== undefined) this.activeCallouts.delete(n);
		// On a control the badge sits on the top-left corner; on bare text,
		// which has no edge to sit on, it sits above and left of the first
		// glyph, in the surrounding gap, so the word stays legible.
		const textual =
			n.kind === "text" || n.kind === "heading" || n.kind === "link";
		const badge =
			number === undefined
				? ""
				: textual
					? this.badge(x - 4, y - 2, number)
					: this.badge(x, y, number);
		if (attrs.length === 0 && !badge) return inner;
		return `<g ${attrs.join(" ")}>\n${inner}\n${badge}\n</g>`;
	}

	/** Numbered callouts for the frame being drawn, by layout node. */
	activeCallouts = new Map<LNode, number>();
	private inChrome = false;

	/** A numbered badge: an accent disc with a numeral that contrasts with
	 * it, no ring. The
	 * baseline sits 0.4em below center, which centers a 10px bold digit
	 * within half a pixel in both browser and librsvg font stacks. */
	badge(cx: number, cy: number, number: number): string {
		return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${BADGE_R}" fill="${this.theme.accent}"/><text x="${round(cx)}" y="${round(cy + 4)}" text-anchor="middle" font-size="10" font-weight="700" fill="${badgeInk(this.theme.accent, this.ink)}">${number}</text>`;
	}

	private drawNode(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		switch (n.kind) {
			case "stack":
				return this.drawStack(n, x, y, w, h);
			case "text":
			case "heading":
			case "link":
				return this.drawText(n, x, y, w);
			case "button":
				return this.drawButton(n, x, y, w, h);
			case "input":
			case "select":
				return this.drawField(n, x, y, w);
			case "checkbox":
			case "radio":
				return this.drawChoice(n, x, y, w);
			case "image":
			case "video":
			case "audio":
				return this.drawMedia(n, x, y, w, h);
			case "table":
				return this.drawTable(n, x, y, w, h);
			case "dialog":
				return this.drawDialog(n, x, y, w, h);
			case "custom":
				return this.drawCustom(n, x, y, w, h);
			case "outlet":
			case "box":
				return this.drawBox(n, x, y, w, h);
		}
	}

	private drawStack(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const parts: string[] = [];
		const innerX = x + n.padding;
		const innerY = y + n.padding;
		const innerW = w - n.padding * 2;
		const innerH = h - n.padding * 2;

		if (n.direction === "row") {
			const { lines } = this.rowLines(n, innerW);
			let ly = innerY;
			for (const line of lines) {
				const count = line.items.length;
				// One line fills the row's height; more share it as measured.
				const lineH = lines.length === 1 ? innerH : line.h;
				let cx =
					innerX + this.justifyOffset(n.justify, innerW, line.totalW, count);
				const extra = this.betweenExtra(n.justify, innerW, line.totalW, count);
				line.items.forEach((i, k) => {
					const child = n.children[i] as LNode;
					const s = line.sizes[k] as Size;
					const stretch =
						n.align === "stretch" || child.height?.kind === "fill";
					const ch = stretch ? lineH : Math.min(s.h, lineH);
					const cy = ly + this.alignOffset(n.align, lineH, ch);
					parts.push(this.draw(child, cx, cy, s.w, ch));
					cx += s.w + n.gap + extra;
				});
				ly += lineH + n.gap;
			}
			return parts.join("\n");
		}

		const { sizes, total } = this.columnSizes(
			n.children,
			innerW,
			innerH,
			n.gap,
			this.columnAuto(n),
		);
		let cy =
			innerY + this.justifyOffset(n.justify, innerH, total, sizes.length);
		const extra = this.betweenExtra(n.justify, innerH, total, sizes.length);
		n.children.forEach((child, i) => {
			const s = sizes[i];
			if (!s) return;
			const cw = Math.min(s.w, innerW);
			const cx = innerX + this.alignOffset(n.align, innerW, cw);
			parts.push(this.draw(child, cx, cy, cw, s.h));
			cy += s.h + n.gap + extra;
		});
		return parts.join("\n");
	}

	private justifyOffset(
		justify: Justify,
		avail: number,
		used: number,
		count: number,
	): number {
		const slack = Math.max(avail - used, 0);
		if (justify === "center") return slack / 2;
		if (justify === "end") return slack;
		if (justify === "between" && count <= 1) return slack / 2;
		return 0;
	}

	private betweenExtra(
		justify: Justify,
		avail: number,
		used: number,
		count: number,
	): number {
		if (justify !== "between" || count <= 1) return 0;
		return Math.max(avail - used, 0) / (count - 1);
	}

	private alignOffset(align: Align, avail: number, used: number): number {
		const slack = Math.max(avail - used, 0);
		if (align === "center") return slack / 2;
		if (align === "end") return slack;
		return 0;
	}

	private drawText(n: LNode, x: number, y: number, w: number): string {
		const size = this.fontSize(n);
		// A selected link is the current place: bold, and not a link to follow.
		const selected = n.kind === "link" && n.flags.has("selected");
		const weight = selected ? 700 : this.fontWeight(n);
		const lines = this.wrap(n.label || " ", w, size, weight);
		const lineH = size * LINE_HEIGHT;
		const fill = n.placeholder || n.flags.has("muted") ? MUTED : this.ink;
		const style =
			n.kind === "link" && !selected ? ' text-decoration="underline"' : "";
		const anchor =
			n.props.align === "center"
				? "middle"
				: n.props.align === "end" || n.props.align === "right"
					? "end"
					: "start";
		const tx = anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x;
		return lines
			.map(
				(line, i) =>
					`<text x="${tx}" y="${round(y + i * lineH + size * 1.05)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${style}>${svgEsc(n.placeholder ? this.fit(line, w, size, weight) : line)}</text>`,
			)
			.join("\n");
	}

	/** A placeholder wider than its box is shortened rather than drawn over
	 * its neighbours: it keeps its tail, the part that names the value, so
	 * `{ticket.show.venue}` becomes `{…venue}`, and is cut only after that.
	 * Literal text is what it says and is never shortened. */
	private fit(
		line: string,
		maxW: number,
		size: number,
		weight: number,
	): string {
		if (this.textWidth(line, size, weight) <= maxW) return line;
		const m = /^\{(.+)\}$/.exec(line);
		if (m) {
			const segments = (m[1] ?? "").split(".");
			while (segments.length > 1) {
				segments.shift();
				const short = `{…${segments.join(".")}}`;
				if (this.textWidth(short, size, weight) <= maxW) return short;
			}
			return this.ellipsize(`{…${segments[0] ?? ""}}`, maxW, size, weight);
		}
		return this.ellipsize(line, maxW, size, weight);
	}

	private drawButton(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const label = n.label || "Button";
		const size = this.fontSize(n);
		const primary = n.flags.has("primary");
		const selected = n.flags.has("selected") || n.flags.has("active");
		const fill = primary ? this.ink : selected ? SURFACE : WHITE;
		const stroke = primary ? this.ink : this.ink;
		const text = primary ? WHITE : this.ink;
		const bh = Math.min(h, CONTROL_HEIGHT);
		const by = y + (h - bh) / 2;
		// A busy button keeps a spinner at its right edge: a ring with a
		// three-quarter arc, the way a loading indicator reads at rest.
		const busy = n.flags.has("busy");
		const spinner = busy
			? this.spinner(x + w - 8 - SPINNER_R, by + bh / 2, text)
			: "";
		const labelW = w - 16 - (busy ? SPINNER_R * 2 + 8 : 0);
		return [
			`<rect x="${x}" y="${round(by)}" width="${w}" height="${bh}" rx="${CONTROL_RADIUS}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
			`<text x="${x + w / 2}" y="${round(by + bh / 2 + size * 0.35)}" font-size="${size}" font-weight="600" fill="${text}" text-anchor="middle">${svgEsc(this.ellipsize(label, labelW, size, 600))}</text>`,
			spinner,
		].join("\n");
	}

	private spinner(cx: number, cy: number, color: string): string {
		const r = SPINNER_R;
		return [
			`<g data-busy="true">`,
			`<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="none" stroke="${LINE}" stroke-width="2"/>`,
			`<path d="M ${round(cx)} ${round(cy - r)} A ${r} ${r} 0 1 1 ${round(cx - r)} ${round(cy)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
			`</g>`,
		].join("\n");
	}

	private drawField(n: LNode, x: number, y: number, w: number): string {
		const parts: string[] = [];
		let fy = y;
		if (n.props.label) {
			parts.push(
				`<text x="${x}" y="${fy + 11}" font-size="${FONT.sm}" font-weight="500" fill="${INK_SOFT}">${svgEsc(n.props.label)}</text>`,
			);
			fy += FIELD_LABEL_HEIGHT;
		}
		const value = n.label;
		const placeholder =
			n.props.placeholder ?? (n.kind === "select" ? "Select…" : "");
		const shown = value || placeholder;
		const fill = n.flags.has("disabled") ? SURFACE : WHITE;
		parts.push(
			`<rect x="${x}" y="${fy}" width="${w}" height="${CONTROL_HEIGHT}" rx="${CONTROL_RADIUS}" fill="${fill}" stroke="${LINE}"/>`,
		);
		if (shown) {
			const textW = n.kind === "select" ? w - 44 : w - 24;
			parts.push(
				`<text x="${x + 12}" y="${round(fy + CONTROL_HEIGHT / 2 + 5)}" font-size="${FONT.md}" fill="${value ? this.ink : MUTED}">${svgEsc(this.ellipsize(shown, textW, FONT.md ?? 14))}</text>`,
			);
		}
		if (n.kind === "select") {
			const cx = x + w - 18;
			const cy = fy + CONTROL_HEIGHT / 2;
			parts.push(
				`<path d="M ${cx - 5} ${cy - 2} L ${cx} ${cy + 3} L ${cx + 5} ${cy - 2}" fill="none" stroke="${INK_SOFT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
			);
		}
		return parts.join("\n");
	}

	private drawChoice(n: LNode, x: number, y: number, w: number): string {
		const size = this.fontSize(n);
		const checked = n.flags.has("checked") || n.flags.has("selected");
		const label = n.label || (n.kind === "checkbox" ? "Checkbox" : "Option");
		const cy = y + CHOICE_SIZE / 2 + 2;
		const parts: string[] = [];
		if (n.kind === "checkbox") {
			parts.push(
				`<rect x="${x}" y="${y + 2}" width="${CHOICE_SIZE}" height="${CHOICE_SIZE}" rx="${CONTROL_RADIUS}" fill="${checked ? this.ink : WHITE}" stroke="${checked ? this.ink : INK_SOFT}" stroke-width="1.2"/>`,
			);
			if (checked) {
				parts.push(
					`<path d="M ${x + 3.5} ${y + 10} L ${x + 7} ${y + 13.5} L ${x + 12.5} ${y + 6}" fill="none" stroke="${WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
				);
			}
		} else {
			parts.push(
				`<circle cx="${x + CHOICE_SIZE / 2}" cy="${cy}" r="${CHOICE_SIZE / 2}" fill="${WHITE}" stroke="${checked ? this.ink : INK_SOFT}" stroke-width="1.2"/>`,
			);
			if (checked) {
				parts.push(
					`<circle cx="${x + CHOICE_SIZE / 2}" cy="${cy}" r="${CHOICE_SIZE / 2 - 4}" fill="${this.ink}"/>`,
				);
			}
		}
		parts.push(
			`<text x="${x + CHOICE_SIZE + 8}" y="${round(cy + size * 0.35)}" font-size="${size}" fill="${n.placeholder ? MUTED : this.ink}">${svgEsc(this.ellipsize(label, w - CHOICE_SIZE - 8, size))}</text>`,
		);
		return parts.join("\n");
	}

	private drawMedia(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const parts: string[] = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${CONTROL_RADIUS}" fill="${SURFACE}" stroke="${LINE}"/>`,
		];
		const cx = x + w / 2;
		const cy = y + h / 2;
		if (n.kind === "audio") {
			const r = 10;
			const px = x + 20;
			parts.push(
				`<circle cx="${px}" cy="${cy}" r="${r}" fill="${this.ink}"/>`,
				`<path d="M ${px - 3} ${cy - 5} L ${px + 5} ${cy} L ${px - 3} ${cy + 5} Z" fill="${WHITE}"/>`,
				`<line x1="${px + 20}" y1="${cy}" x2="${x + w - 16}" y2="${cy}" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>`,
				`<line x1="${px + 20}" y1="${cy}" x2="${px + 20 + (w - 56) * 0.35}" y2="${cy}" stroke="${this.ink}" stroke-width="3" stroke-linecap="round"/>`,
			);
		} else if (n.kind === "video") {
			const r = Math.min(20, h * 0.25);
			parts.push(
				`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${this.ink}"/>`,
				`<path d="M ${cx - r * 0.3} ${cy - r * 0.5} L ${cx + r * 0.5} ${cy} L ${cx - r * 0.3} ${cy + r * 0.5} Z" fill="${WHITE}"/>`,
			);
		} else {
			const s = Math.min(40, h * 0.5, w * 0.5);
			const ix = cx - s / 2;
			const iy = cy - s / 2;
			parts.push(
				`<rect x="${ix}" y="${iy}" width="${s}" height="${s}" rx="${CONTROL_RADIUS}" fill="none" stroke="${MUTED}" stroke-width="1.5"/>`,
				`<circle cx="${ix + s * 0.3}" cy="${iy + s * 0.3}" r="${s * 0.09}" fill="${MUTED}"/>`,
				`<path d="M ${ix + s * 0.08} ${iy + s * 0.85} L ${ix + s * 0.38} ${iy + s * 0.5} L ${ix + s * 0.58} ${iy + s * 0.72} L ${ix + s * 0.7} ${iy + s * 0.6} L ${ix + s * 0.92} ${iy + s * 0.85}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-linejoin="round"/>`,
			);
		}
		if (n.label && n.kind === "image" && h >= 100) {
			parts.push(
				`<text x="${x + 8}" y="${y + h - 8}" font-size="${FONT.xs}" fill="${MUTED}">${svgEsc(this.ellipsize(n.label, w - 16, FONT.xs ?? 11))}</text>`,
			);
		}
		return parts.join("\n");
	}

	private drawTable(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const parts: string[] = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${CONTROL_RADIUS}" fill="${WHITE}" stroke="${LINE}"/>`,
			`<path d="M ${x} ${y + CONTROL_HEIGHT} H ${x + w}" stroke="${LINE}"/>`,
			`<path d="M ${x + CONTROL_RADIUS} ${y} H ${x + w - CONTROL_RADIUS} A ${CONTROL_RADIUS} ${CONTROL_RADIUS} 0 0 1 ${x + w} ${y + CONTROL_RADIUS} V ${y + CONTROL_HEIGHT} H ${x} V ${y + CONTROL_RADIUS} A ${CONTROL_RADIUS} ${CONTROL_RADIUS} 0 0 1 ${x + CONTROL_RADIUS} ${y} Z" fill="${SURFACE}"/>`,
		];
		const columns = this.tableColumns(n);
		const colW = w / columns.length;
		columns.forEach((col, i) => {
			parts.push(
				`<text x="${round(x + i * colW + 12)}" y="${round(y + CONTROL_HEIGHT / 2 + 4)}" font-size="${FONT.sm}" font-weight="600" fill="${INK_SOFT}">${svgEsc(this.ellipsize(col, colW - 20, FONT.sm ?? 12, 600))}</text>`,
			);
			if (i > 0) {
				parts.push(
					`<line x1="${round(x + i * colW)}" y1="${y}" x2="${round(x + i * colW)}" y2="${y + h}" stroke="${LINE}"/>`,
				);
			}
		});

		if (n.children.length > 0) {
			const pad = 8;
			const { sizes } = this.columnSizes(
				n.children,
				w - 2,
				undefined,
				pad,
				"fill",
			);
			let cy = y + CONTROL_HEIGHT + pad;
			n.children.forEach((child, i) => {
				const s = sizes[i];
				if (!s) return;
				parts.push(this.draw(child, x + 1, cy, w - 2, s.h));
				cy += s.h + pad;
				if (i < n.children.length - 1) {
					parts.push(
						`<line x1="${x}" y1="${round(cy - pad / 2)}" x2="${x + w}" y2="${round(cy - pad / 2)}" stroke="${SURFACE}"/>`,
					);
				}
			});
			return parts.join("\n");
		}

		const rows = this.tableRows(n);
		for (let r = 0; r < rows; r++) {
			const ry = y + CONTROL_HEIGHT + r * 32;
			if (r > 0)
				parts.push(
					`<line x1="${x}" y1="${ry}" x2="${x + w}" y2="${ry}" stroke="${SURFACE}"/>`,
				);
			columns.forEach((_, i) => {
				const barW = Math.max(colW * (0.45 + ((r * 7 + i * 3) % 4) * 0.1), 16);
				parts.push(
					`<rect x="${round(x + i * colW + 12)}" y="${ry + 12}" width="${round(barW)}" height="8" rx="${CONTROL_RADIUS}" fill="${SURFACE}"/>`,
				);
			});
		}
		return parts.join("\n");
	}

	private drawDialog(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const pad = SPACE.lg ?? 16;
		const parts: string[] = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${CONTROL_RADIUS}" fill="${WHITE}" stroke="${this.ink}" stroke-width="1.2"/>`,
		];
		let cy = y + pad;
		if (n.label) {
			const size = FONT.lg ?? 18;
			parts.push(
				`<text x="${x + pad}" y="${round(cy + size * 1.05)}" font-size="${size}" font-weight="700" fill="${n.placeholder ? MUTED : this.ink}">${svgEsc(this.ellipsize(n.label, w - pad * 2, size, 700))}</text>`,
			);
			cy += Math.ceil(size * LINE_HEIGHT) + (SPACE.md ?? 12);
		}
		const innerW = w - pad * 2;
		const { sizes } = this.columnSizes(
			n.children,
			innerW,
			undefined,
			DEFAULT_GAP,
			"fill",
		);
		n.children.forEach((child, i) => {
			const s = sizes[i];
			if (!s) return;
			parts.push(this.draw(child, x + pad, cy, innerW, s.h));
			cy += s.h + DEFAULT_GAP;
		});
		return parts.join("\n");
	}

	private drawBox(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const label = this.boxLabel(n);
		const parts: string[] = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${CONTROL_RADIUS}" fill="${WHITE}" stroke="${MUTED}" stroke-dasharray="4,3"/>`,
		];
		if (n.children.length === 0) {
			parts.push(
				`<text x="${x + w / 2}" y="${round(y + h / 2 + 4)}" font-family="${FONT_MONO}" font-size="${FONT.sm}" fill="${INK_SOFT}" text-anchor="middle">${svgEsc(this.ellipsize(label, w - 16, FONT.sm ?? 12))}</text>`,
			);
			return parts.join("\n");
		}
		const pad = 12;
		parts.push(
			`<text x="${x + pad}" y="${y + 13}" font-family="${FONT_MONO}" font-size="${FONT.xs}" fill="${MUTED}">${svgEsc(this.ellipsize(label, w - pad * 2, FONT.xs ?? 11))}</text>`,
		);
		const innerW = w - pad * 2;
		const { sizes } = this.columnSizes(
			n.children,
			innerW,
			undefined,
			DEFAULT_GAP,
			"fill",
		);
		let cy = y + pad + 16;
		n.children.forEach((child, i) => {
			const s = sizes[i];
			if (!s) return;
			parts.push(this.draw(child, x + pad, cy, innerW, s.h));
			cy += s.h + DEFAULT_GAP;
		});
		return parts.join("\n");
	}

	private drawCustom(
		n: LNode,
		x: number,
		y: number,
		w: number,
		h: number,
	): string {
		const render = n.adapter?.renderSvg;
		if (!render) return this.drawBox(n, x, y, w, h);
		const pad = 12;
		const innerW = w - pad * 2;
		const { sizes } = this.columnSizes(
			n.children,
			innerW,
			undefined,
			DEFAULT_GAP,
			"fill",
		);
		const childParts: string[] = [];
		let cy = y + pad + 16;
		n.children.forEach((child, i) => {
			const s = sizes[i];
			if (!s) return;
			childParts.push(this.draw(child, x + pad, cy, innerW, s.h));
			cy += s.h + DEFAULT_GAP;
		});
		return render({
			ast: this.ast,
			node: n.source,
			label: n.label || n.title,
			x,
			y,
			width: w,
			height: h,
			childrenSvg: childParts.join("\n"),
		});
	}

	// ─── ASCII ─────────────────────────────────────────────────────────────────

	private fontSize(n: LNode): number {
		if (n.kind === "heading") {
			const level = Number.parseInt(n.props.level ?? "2", 10);
			return level <= 1
				? (FONT.xl ?? 24)
				: level === 2
					? (FONT.lg ?? 18)
					: (FONT.md ?? 14);
		}
		const named = n.props.size ? FONT[n.props.size] : undefined;
		if (named !== undefined) return named;
		const parsed = Number.parseInt(n.props.size ?? "", 10);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
		return FONT.md ?? 14;
	}

	private fontWeight(n: LNode): number {
		if (n.kind === "heading") return 700;
		const weight = n.props.weight;
		if (weight === "bold" || n.flags.has("bold")) return 700;
		if (weight === "medium") return 500;
		if (weight === "semibold") return 600;
		const parsed = Number.parseInt(weight ?? "", 10);
		if (Number.isFinite(parsed) && parsed >= 100) return parsed;
		return 400;
	}

	private aspect(n: LNode, fallback: number): number {
		const raw = n.props.aspect;
		if (!raw) return fallback;
		const m = /^(\d+(?:\.\d+)?)[:/x](\d+(?:\.\d+)?)$/.exec(raw);
		if (m) {
			const a = Number.parseFloat(m[1] ?? "0");
			const b = Number.parseFloat(m[2] ?? "0");
			if (a > 0 && b > 0) return a / b;
		}
		const single = Number.parseFloat(raw);
		return Number.isFinite(single) && single > 0 ? single : fallback;
	}

	tableColumns(n: LNode): string[] {
		const raw = n.props.columns;
		if (raw) {
			const cols = raw
				.split(",")
				.map((c) => c.trim())
				.filter(Boolean);
			if (cols.length > 0) return cols;
		}
		return ["Column", "Column", "Column"];
	}

	private tableRows(n: LNode): number {
		const parsed = Number.parseInt(n.props.rows ?? "", 10);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
	}

	private boxLabel(n: LNode): string {
		return n.id ? `${n.title} #${n.id}` : n.title;
	}

	/** Approximate glyph advance for the system sans stack. */
	/** Approximate advance for the system sans stack, by character class.
	 * A flat per-character factor overstates most text by about a sixth,
	 * which made rows wrap or shrink that fit on screen. */
	textWidth(text: string, size: number, weight = 400): number {
		let em = 0;
		for (const ch of text) em += charEm(ch);
		return em * size * (weight >= 600 ? 1.06 : 1);
	}

	private wrap(
		text: string,
		maxW: number,
		size: number,
		weight: number,
	): string[] {
		const lines: string[] = [];
		for (const paragraph of text.split("\\n")) {
			const words = paragraph.split(/\s+/).filter(Boolean);
			if (words.length === 0) {
				lines.push("");
				continue;
			}
			let current = "";
			for (const word of words) {
				const candidate = current ? `${current} ${word}` : word;
				if (current && this.textWidth(candidate, size, weight) > maxW) {
					lines.push(current);
					current = word;
				} else {
					current = candidate;
				}
			}
			if (current) lines.push(current);
		}
		return lines.length > 0 ? lines : [""];
	}

	private ellipsize(
		text: string,
		maxW: number,
		size: number,
		weight = 400,
	): string {
		if (this.textWidth(text, size, weight) <= maxW) return text;
		let out = text;
		while (out.length > 1 && this.textWidth(`${out}…`, size, weight) > maxW) {
			out = out.slice(0, -1);
		}
		return `${out.trimEnd()}…`;
	}
}

type Effective = {
	label: string;
	placeholder: boolean;
	attributes: Record<string, string>;
	flags: Set<string>;
	handlers: UiHandler[];
	/** False when the node shows data that is not in hand in this view. */
	available: boolean;
	data?: string;
	/** A mode set on a component instance by an override: `#nav @search`. */
	mode?: string;
};

// ─── Callouts ────────────────────────────────────────────────────────────────

/** Something a person can do in a frame: an event on an element, with the
 * action it leads to; or following a link. `origin` is the element to
 * badge. */
export type Callout = {
	origin: LNode;
	event: string;
	/** Printed action: `go Band(id=picked.id)`, `@shows`, `~signIn`. */
	action: string;
	handler?: UiHandler;
	/** A link's destination, when the callout is a `to=`. */
	to?: string;
};

/** Every callout in a built frame, in drawing order. Hidden elements are
 * not built; inert ones (a `disabled` button, a `selected` link) are drawn
 * but fire nothing. A modal takes the interaction, so while one is up only
 * its elements count. A handler on a component instance is traced to the
 * element inside it that emits the event. */
export function frameCallouts(frame: Frame): Callout[] {
	const out: Callout[] = [];
	const walk = (n: LNode, inside: boolean) => {
		if (!n.inert && !n.chrome) {
			// A root's own handlers are inside the component it roots.
			const handlers = [
				...n.handlers.map((h) => ({ h, within: inside })),
				...(n.ownHandlers ?? []).map((h) => ({ h, within: true })),
			];
			for (const { h, within } of handlers) {
				// Inside an expanded component an emit is internal: the
				// instance's handler for it is the callout.
				if (within && h.action.kind === "emit") continue;
				// A handler on an instance is badged on the element inside
				// that emits its event, and reads as the parent wrote it:
				// `TrackRow(track) $select(picked) => @playing(picked)` lists
				// `select(picked) → @playing(picked)` on the row; the row's own
				// frame explains `click → $select(track)`.
				const origin = n.component ? (originOf(n, h.event)?.node ?? n) : n;
				if (origin.inert) continue;
				out.push({
					origin,
					event: h.param !== undefined ? `${h.event}(${h.param})` : h.event,
					action: printAction(h),
					handler: h,
				});
			}
			if (n.kind === "link" && n.props.to) {
				out.push({
					origin: n,
					event: "click",
					action: `go ${n.props.to}`,
					to: n.props.to,
				});
			}
		}
		// A list's children are copies of one item; walk it once.
		const within = inside || n.component !== undefined;
		if (n.repeatItem) walk(n.repeatItem, within);
		else for (const c of n.children) walk(c, within);
	};
	if (frame.modals.length === 0) walk(frame.content, false);
	for (const m of frame.modals) walk(m, false);
	return out;
}

/** The callouts each view in a row lists. A view that shows an io condition
 * is its mode's resting view with that condition applied, so it calls out
 * only what the condition adds: a retry button, a modal's choices. The
 * actions the resting view already lists (tabs, links, nav) are not
 * repeated under every variant. */
export function rowCallouts(frames: Frame[]): Callout[][] {
	const all = frames.map((f) => frameCallouts(f));
	return all.map((list, i) => {
		const view = frames[i]?.view;
		if (!view?.io) return list;
		const base = frames.findIndex(
			(f) => !f.view.io && f.view.mode === view.mode,
		);
		const known = base >= 0 ? (all[base] ?? []) : [];
		return list.filter(
			(c) =>
				!known.some(
					(k) =>
						k.origin.source === c.origin.source &&
						k.event === c.event &&
						k.action === c.action,
				),
		);
	});
}

/** Inside an expanded component, the element whose handler emits `event`
 * and the event a person fires on it, through any number of forwarding
 * instances (`$close => $close`). The component's own root line counts
 * (`Stack $click => $open(show)`). */
export function originOf(
	root: LNode,
	event: string,
): { node: LNode; event: string } | undefined {
	const emits = (list: UiHandler[]) =>
		list.find((x) => x.action.kind === "emit" && x.action.event === event);
	const own = emits(root.ownHandlers ?? []);
	if (own) return { node: root, event: own.event };
	let hit: { node: LNode; event: string } | undefined;
	const search = (n: LNode) => {
		if (hit) return;
		for (const c of n.repeatItem ? [n.repeatItem] : n.children) {
			if (hit) return;
			const h = emits(c.handlers);
			if (h) {
				hit = c.component
					? (originOf(c, h.event) ?? { node: c, event: h.event })
					: { node: c, event: h.event };
				return;
			}
			search(c);
		}
	};
	search(root);
	return hit;
}

function printAction(h: UiHandler): string {
	const a = h.action;
	switch (a.kind) {
		case "mode":
			return `@${a.mode}${a.value !== undefined ? `(${a.value})` : ""}`;
		case "emit":
			return `$${a.event}${a.value !== undefined ? `(${a.value})` : ""}`;
		case "io":
			return `~${a.name}`;
		case "go": {
			const args = Object.entries(a.args).map(([k, v]) =>
				k === v ? k : `${k}=${v}`,
			);
			return `go ${a.screen}${args.length ? `(${args.join(", ")})` : ""}`;
		}
	}
}

/** What a frame's legend calls the element a callout sits on: its content
 * or placeholder, else its type. */
export function elementName(n: LNode): string {
	return (
		n.label ||
		n.props.placeholder ||
		n.props.label ||
		n.component ||
		n.name ||
		n.title ||
		""
	);
}

/** What a fill child (a field, a nested stack) is given when a row is
 * packed into lines; it then shares its line's leftover. */
const ROW_FILL_MIN_W = 96;

type RowLine = { items: number[]; sizes: Size[]; h: number; totalW: number };
type RowLines = { lines: RowLine[]; height: number };

/** Advance width of a character in ems, for the system sans stack. */
function isQuoted(v: string): boolean {
	return v.length >= 2 && v.startsWith('"') && v.endsWith('"');
}

function charEm(ch: string): number {
	if (ch === " ") return 0.28;
	if ("iljI!|'.,:;".includes(ch)) return 0.27;
	if ("ftr()[]{}/\\-".includes(ch)) return 0.34;
	if ("mwMW".includes(ch)) return 0.85;
	if (ch === "…") return 1;
	if (ch >= "A" && ch <= "Z") return 0.66;
	if (ch >= "0" && ch <= "9") return 0.56;
	if (ch >= "a" && ch <= "z") return 0.53;
	return 0.6;
}

/** Does the node hold nothing of the screen: only layout nodes? */
function allChrome(n: LNode): boolean {
	if (!n.chrome) return false;
	const children = n.repeatItem ? [n.repeatItem] : n.children;
	return children.every(allChrome);
}

export function round(value: number): number {
	return Math.round(value * 100) / 100;
}
