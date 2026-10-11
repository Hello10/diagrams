import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { FONT_MONO } from "../../style.ts";
import { svgEsc } from "../../svg.ts";
import { getWireframeLibraryAdapter } from "./wireframeAdapters.ts";
import { wireframeToPlaintext } from "./wireframeToPlaintext.ts";
import {
	WIREFRAME_DEFAULT_STATE,
	WIREFRAME_DEFAULT_VIEWPORT,
	type WireframeAST,
	type WireframeCanonicalRenderType,
	type WireframeComponentRef,
	type WireframeElementNode,
	type WireframeInteractionKind,
	type WireframeLibraryComponentAdapter,
	type WireframeOverride,
	type WireframeViewport,
} from "./wireframeTypes.ts";

// ─── Scales ──────────────────────────────────────────────────────────────────

/** Spacing scale. `gap` and `padding` accept these names or a pixel number. */
const SPACE: Record<string, number> = {
	none: 0,
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
	xxl: 32,
};
const DEFAULT_GAP = SPACE.md ?? 12;

/** Type scale. `size` on text accepts these names. */
const FONT: Record<string, number> = {
	xs: 11,
	sm: 12,
	md: 14,
	lg: 18,
	xl: 24,
	xxl: 32,
};
const LINE_HEIGHT = 1.4;

const CONTROL_HEIGHT = 36;
const CONTROL_RADIUS = 6;
const CHOICE_SIZE = 16;
const FIELD_LABEL_HEIGHT = 18;

const FRAME_PADDING = 16;
const FRAME_MIN_HEIGHT = 200;
const FRAME_RADIUS = 12;
const FRAME_GAP = 40;
const SECTION_GAP = 56;
const CAPTION_HEIGHT = 26;
const CANVAS_PAD = 40;
const MODAL_MAX_WIDTH = 400;
const MODAL_MARGIN = 24;
const DEFINITION_WIDTH = 320;

// Grayscale wireframe palette.
const INK = "#1f2937";
const INK_SOFT = "#4b5563";
const MUTED = "#9ca3af";
const LINE = "#d1d5db";
const SURFACE = "#f3f4f6";
const WHITE = "#ffffff";
const DIM = "rgba(17, 24, 39, 0.45)";

/** Clip-path ids must be unique per document; a wireflow can embed frames
 * from several renderer instances, so the counter is module-level. */
let clipCounter = 0;

// ─── Layout tree ─────────────────────────────────────────────────────────────

type Sizing =
	| { kind: "fill" }
	| { kind: "hug" }
	| { kind: "fixed"; px: number };
type Align = "start" | "center" | "end" | "stretch";
type Justify = "start" | "center" | "end" | "between";
type Direction = "row" | "column";
type LKind = WireframeCanonicalRenderType | "stack" | "box" | "custom";

/** A node of the expanded layout tree: defines expanded, overrides applied,
 * repeats unrolled, modals lifted out. Both the SVG and the ASCII renderers
 * walk this tree, so the two stay in step by construction. */
interface LNode {
	kind: LKind;
	source: WireframeElementNode;
	/** Effective content: the string, or the param name when unbound. */
	label: string;
	/** True when `label` stands in for an unbound `$param`. */
	placeholder: boolean;
	props: Record<string, string>;
	flags: Set<string>;
	data?: string;
	interaction?: { kind: WireframeInteractionKind; target: string };
	children: LNode[];
	direction: Direction;
	gap: number;
	padding: number;
	align: Align;
	justify: Justify;
	width?: Sizing;
	height?: Sizing;
	/** Display name for `box` and `custom` nodes (the component as written). */
	title: string;
	adapter?: WireframeLibraryComponentAdapter;
	/** Set on a stack produced by `repeat`: how many copies it holds. */
	repeatCount?: number;
	/** Set on a repeat's stack: the item template, for the ASCII renderer. */
	repeatItem?: LNode;
}

interface BuildContext {
	/** Overrides by declared id, state's first then the viewport's. */
	overrides: Map<string, WireframeOverride[]>;
	/** `$param` → value, from a define use site. */
	bindings: Map<string, string>;
	/** Defines currently being expanded, to stop recursion. */
	trail: Set<string>;
	/** Modals encountered while building; drawn as overlays. */
	modals: LNode[];
}

interface Size {
	w: number;
	h: number;
}

interface Frame {
	screen: WireframeElementNode;
	state: string;
	viewport: WireframeViewport;
	content: LNode;
	modals: LNode[];
	contentHeight: number;
	height: number;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export class WireframeRenderer extends DiagramRenderer<WireframeAST> {
	protected readonly width: number;
	protected readonly height: number;
	private readonly body: string;

	constructor(ast: WireframeAST) {
		super(ast);
		const parts: string[] = [];
		let cy = CANVAS_PAD;
		let maxRight = 0;

		const viewports =
			ast.viewports.length > 0 ? ast.viewports : [WIREFRAME_DEFAULT_VIEWPORT];
		const root = ast.elements[ast.root];
		const screens = (root?.children ?? [])
			.map((id) => ast.elements[id])
			.filter(
				(node): node is WireframeElementNode => node?.nodeKind === "screen",
			);

		for (const screen of screens) {
			const states = [
				WIREFRAME_DEFAULT_STATE,
				...(screen.states ?? []).map((s) => s.name),
			];
			for (const state of states) {
				let cx = CANVAS_PAD;
				let rowHeight = 0;
				for (const viewport of viewports) {
					const frame = this.buildFrame(screen, state, viewport);
					parts.push(this.drawFrame(frame, cx, cy));
					cx += viewport.width + FRAME_GAP;
					rowHeight = Math.max(rowHeight, CAPTION_HEIGHT + frame.height);
					maxRight = Math.max(maxRight, cx - FRAME_GAP);
				}
				cy += rowHeight + FRAME_GAP;
			}
			cy += SECTION_GAP - FRAME_GAP;
		}

		const defineNames = Object.keys(ast.defines);
		if (defineNames.length > 0) {
			parts.push(
				`<text x="${CANVAS_PAD}" y="${cy + 14}" font-size="${FONT.lg}" font-weight="700" fill="${INK}">Components</text>`,
			);
			cy += 40;
			let cx = CANVAS_PAD;
			let rowHeight = 0;
			for (const name of defineNames) {
				const def = ast.defines[name];
				if (!def) continue;
				const ctx = this.newContext();
				const roots = this.buildMany(def.template, ctx);
				const content = this.syntheticStack(roots, "column", DEFAULT_GAP);
				const innerW = DEFINITION_WIDTH - FRAME_PADDING * 2;
				const size = this.measure(content, innerW, "fill");
				const boxH = size.h + FRAME_PADDING * 2;
				if (
					cx > CANVAS_PAD &&
					cx + DEFINITION_WIDTH > Math.max(maxRight, 960)
				) {
					cx = CANVAS_PAD;
					cy += rowHeight + FRAME_GAP;
					rowHeight = 0;
				}
				parts.push(
					`<text x="${cx}" y="${cy + 14}" font-size="${FONT.md}" font-weight="700" fill="${INK}">${svgEsc(name)}</text>`,
					`<text x="${cx + this.textWidth(name, FONT.md ?? 14, 700) + 10}" y="${cy + 14}" font-family="${FONT_MONO}" font-size="${FONT.xs}" fill="${MUTED}">${svgEsc(def.params.map((p) => `$${p}`).join(" "))}</text>`,
					`<rect x="${cx}" y="${cy + CAPTION_HEIGHT}" width="${DEFINITION_WIDTH}" height="${boxH}" rx="8" fill="${WHITE}" stroke="${LINE}" stroke-dasharray="4,3"/>`,
					this.draw(
						content,
						cx + FRAME_PADDING,
						cy + CAPTION_HEIGHT + FRAME_PADDING,
						innerW,
						size.h,
					),
				);
				rowHeight = Math.max(rowHeight, CAPTION_HEIGHT + boxH);
				cx += DEFINITION_WIDTH + FRAME_GAP;
				maxRight = Math.max(maxRight, cx - FRAME_GAP);
			}
			cy += rowHeight + FRAME_GAP;
		}

		this.width = Math.max(maxRight + CANVAS_PAD, 320);
		this.height = Math.max(cy - FRAME_GAP + CANVAS_PAD, 160);
		this.body = parts.join("\n");
	}

	protected renderBody(): string {
		return this.body;
	}

	protected override renderDefs(): string {
		return WireframeRenderer.frameDefs();
	}

	protected override extraTextStyles(): string {
		// No `fill` here: a CSS rule would beat the per-element fill attribute
		// (white labels on primary buttons, muted placeholders).
		return "cursor: default; user-select: none;";
	}

	toPlaintext(): string {
		return wireframeToPlaintext(this.ast);
	}

	/** Text rendering of the same expanded tree the SVG draws: one block per
	 * screen state, canonical types in brackets, stacks as `row` / `column`.
	 * Viewport overrides are layout-only and are not shown. */
	renderAscii(): string {
		const ast = this.ast;
		const lines: string[] = [];
		const root = ast.elements[ast.root];
		for (const id of root?.children ?? []) {
			const screen = ast.elements[id];
			if (screen?.nodeKind !== "screen") continue;
			const states = [
				WIREFRAME_DEFAULT_STATE,
				...(screen.states ?? []).map((s) => s.name),
			];
			for (const state of states) {
				const frame = this.buildFrame(
					screen,
					state,
					WIREFRAME_DEFAULT_VIEWPORT,
				);
				lines.push(
					state === WIREFRAME_DEFAULT_STATE
						? `screen ${screen.screenName ?? "Screen"}`
						: `screen ${screen.screenName ?? "Screen"} state ${state}`,
				);
				for (const child of frame.content.children) {
					lines.push(...this.asciiNode(child, 1));
				}
				for (const modal of frame.modals) {
					lines.push("  modal");
					lines.push(...this.asciiNode(modal, 2));
				}
				lines.push("");
			}
		}

		const defineNames = Object.keys(ast.defines);
		if (defineNames.length > 0) {
			lines.push("components");
			for (const name of defineNames) {
				const def = ast.defines[name];
				if (!def) continue;
				lines.push(`  ${name}${def.params.map((p) => ` $${p}`).join("")}`);
				const ctx = this.newContext();
				for (const node of this.buildMany(def.template, ctx)) {
					lines.push(...this.asciiNode(node, 2));
				}
			}
		}
		return lines.join("\n").trimEnd();
	}

	// ─── Frames ────────────────────────────────────────────────────────────────

	private buildFrame(
		screen: WireframeElementNode,
		state: string,
		viewport: WireframeViewport,
	): Frame {
		const ctx = this.newContext();
		const stateBlock = (screen.states ?? []).find((s) => s.name === state);
		for (const override of stateBlock?.overrides ?? []) {
			this.addOverride(ctx, override);
		}
		const viewportBlock = (screen.viewportOverrides ?? []).find(
			(v) => v.viewport === viewport.name,
		);
		for (const override of viewportBlock?.overrides ?? []) {
			this.addOverride(ctx, override);
		}

		const ids = [...(screen.children ?? []), ...(stateBlock?.children ?? [])];
		const roots = this.buildMany(ids, ctx);
		const content = this.syntheticStack(roots, "column", DEFAULT_GAP);
		const innerW = viewport.width - FRAME_PADDING * 2;
		const contentHeight = this.measure(content, innerW, "fill").h;

		let height = Math.max(contentHeight + FRAME_PADDING * 2, FRAME_MIN_HEIGHT);
		for (const modal of ctx.modals) {
			const modalW = Math.min(
				MODAL_MAX_WIDTH,
				viewport.width - MODAL_MARGIN * 2,
			);
			const modalH = this.measure(modal, modalW, "fill").h;
			height = Math.max(height, modalH + MODAL_MARGIN * 2 + FRAME_PADDING * 2);
		}

		return {
			screen,
			state,
			viewport,
			content,
			modals: ctx.modals,
			contentHeight,
			height,
		};
	}

	/** One screen state at one viewport, drawn at the origin without a
	 * caption. Used by the wireflow renderer for thumbnails. Returns
	 * undefined when the screen or state does not exist. */
	renderFrame(
		screenName: string,
		state: string = WIREFRAME_DEFAULT_STATE,
		viewportName?: string,
	): { svg: string; width: number; height: number } | undefined {
		const root = this.ast.elements[this.ast.root];
		const screen = (root?.children ?? [])
			.map((id) => this.ast.elements[id])
			.find((n) => n?.nodeKind === "screen" && n.screenName === screenName);
		if (!screen) return undefined;
		if (
			state !== WIREFRAME_DEFAULT_STATE &&
			!(screen.states ?? []).some((s) => s.name === state)
		) {
			return undefined;
		}
		const viewports =
			this.ast.viewports.length > 0
				? this.ast.viewports
				: [WIREFRAME_DEFAULT_VIEWPORT];
		const viewport =
			viewports.find((v) => v.name === viewportName) ?? viewports[0];
		if (!viewport) return undefined;
		const frame = this.buildFrame(screen, state, viewport);
		return {
			svg: this.drawFrameBody(frame, 0, 0),
			width: viewport.width,
			height: frame.height,
		};
	}

	/** The `<defs>` a frame relies on, for renderers that embed frames. */
	static frameDefs(): string {
		return `<filter id="wf-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#111827" flood-opacity="0.25"/></filter>`;
	}

	private drawFrame(frame: Frame, x: number, y: number): string {
		const { viewport } = frame;
		const parts: string[] = [];
		const screenName = frame.screen.screenName ?? "Screen";
		const captionY = y + 14;
		let captionX = x;
		parts.push(
			`<text x="${captionX}" y="${captionY}" font-size="${FONT.md}" font-weight="700" fill="${INK}">${svgEsc(screenName)}</text>`,
		);
		captionX += this.textWidth(screenName, FONT.md ?? 14, 700) + 10;
		if (frame.state !== WIREFRAME_DEFAULT_STATE) {
			parts.push(
				`<text x="${captionX}" y="${captionY}" font-family="${FONT_MONO}" font-size="${FONT.sm}" fill="${INK_SOFT}">${svgEsc(frame.state)}</text>`,
			);
			captionX += this.textWidth(frame.state, FONT.sm ?? 12) + 12;
		}
		parts.push(
			`<text x="${captionX}" y="${captionY}" font-family="${FONT_MONO}" font-size="${FONT.xs}" fill="${MUTED}">${svgEsc(`${viewport.name} ${viewport.width}`)}</text>`,
		);
		parts.push(this.drawFrameBody(frame, x, y + CAPTION_HEIGHT));
		return parts.join("\n");
	}

	private drawFrameBody(frame: Frame, x: number, fy: number): string {
		const { viewport } = frame;
		const parts: string[] = [];
		const screenName = frame.screen.screenName ?? "Screen";
		const fw = viewport.width;
		const fh = frame.height;
		const clipId = `wf-clip-${clipCounter++}`;
		parts.push(
			`<g data-screen="${svgEsc(screenName)}" data-state="${svgEsc(frame.state)}" data-viewport="${svgEsc(viewport.name)}">`,
			`<rect x="${x}" y="${fy}" width="${fw}" height="${fh}" rx="${FRAME_RADIUS}" fill="${WHITE}" stroke="${INK}" stroke-width="1.5"/>`,
			`<clipPath id="${clipId}"><rect x="${x}" y="${fy}" width="${fw}" height="${fh}" rx="${FRAME_RADIUS}"/></clipPath>`,
		);
		parts.push(`<g clip-path="url(#${clipId})">`);
		parts.push(
			this.draw(
				frame.content,
				x + FRAME_PADDING,
				fy + FRAME_PADDING,
				fw - FRAME_PADDING * 2,
				frame.contentHeight,
			),
		);

		for (const modal of frame.modals) {
			const modalW = Math.min(MODAL_MAX_WIDTH, fw - MODAL_MARGIN * 2);
			const modalH = this.measure(modal, modalW, "fill").h;
			const mx = x + (fw - modalW) / 2;
			const my = fy + Math.max(MODAL_MARGIN, (fh - modalH) / 2);
			parts.push(
				`<rect x="${x}" y="${fy}" width="${fw}" height="${fh}" fill="${DIM}"/>`,
				`<g filter="url(#wf-shadow)">`,
				`<rect x="${mx}" y="${my}" width="${modalW}" height="${modalH}" rx="12" fill="${WHITE}"/>`,
				`</g>`,
				this.draw(modal, mx, my, modalW, modalH),
			);
		}
		parts.push("</g>", "</g>");
		return parts.join("\n");
	}

	// ─── Build: AST → layout tree ──────────────────────────────────────────────

	private newContext(): BuildContext {
		return {
			overrides: new Map(),
			bindings: new Map(),
			trail: new Set(),
			modals: [],
		};
	}

	private addOverride(ctx: BuildContext, override: WireframeOverride): void {
		const list = ctx.overrides.get(override.id) ?? [];
		list.push(override);
		ctx.overrides.set(override.id, list);
	}

	private buildMany(ids: string[], ctx: BuildContext): LNode[] {
		const out: LNode[] = [];
		for (const id of ids) {
			const node = this.ast.elements[id];
			if (!node) continue;
			const built = this.build(node, ctx);
			if (built) out.push(built);
		}
		return out;
	}

	private build(
		node: WireframeElementNode,
		ctx: BuildContext,
	): LNode | undefined {
		const eff = this.effective(node, ctx);
		if (eff.flags.has("hidden")) return undefined;

		if (node.nodeKind === "modal") {
			const children = this.buildMany(node.children ?? [], ctx);
			const modal =
				children.length === 1 && children[0]
					? children[0]
					: this.syntheticStack(children, "column", DEFAULT_GAP, node);
			ctx.modals.push(modal);
			return undefined;
		}

		if (node.nodeKind === "repeat") {
			return this.buildRepeat(node, eff, ctx);
		}

		const ref = node.component;
		if (ref?.kind === "local") {
			return this.expandDefine(node, ref.name, eff, ctx);
		}

		const adapter = this.adapterFor(ref);
		const kind: LKind = adapter?.renderSvg
			? "custom"
			: (adapter?.type ?? "box");
		const lnode = this.baseNode(kind, node, eff);
		lnode.adapter = adapter;
		lnode.children = this.buildMany(node.children ?? [], ctx);
		return lnode;
	}

	private buildRepeat(
		node: WireframeElementNode,
		eff: Effective,
		ctx: BuildContext,
	): LNode {
		const parsedCount = Number.parseInt(eff.attributes.count ?? "", 10);
		const count =
			Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 3;
		const children = this.buildMany(node.children ?? [], ctx);
		const item =
			children.length === 1 && children[0]
				? children[0]
				: this.syntheticStack(children, "column", SPACE.sm ?? 8, node);
		const stack = this.baseNode("stack", node, eff);
		stack.children = Array.from({ length: count }, () => item);
		stack.repeatCount = count;
		stack.repeatItem = item;
		return stack;
	}

	private expandDefine(
		node: WireframeElementNode,
		name: string,
		eff: Effective,
		ctx: BuildContext,
	): LNode {
		const def = this.ast.defines[name];
		if (!def || ctx.trail.has(name)) {
			const box = this.baseNode("box", node, eff);
			box.title = def ? `${name} (recursive)` : name;
			return box;
		}

		const bindings = new Map<string, string>();
		const layoutProps: Record<string, string> = {};
		for (const [key, value] of Object.entries(eff.attributes)) {
			if (def.params.includes(key)) {
				bindings.set(key, this.resolveBinding(value, ctx));
			} else {
				layoutProps[key] = value;
			}
		}
		const inner: BuildContext = {
			overrides: new Map(),
			bindings,
			trail: new Set([...ctx.trail, name]),
			modals: ctx.modals,
		};
		const roots = this.buildMany(def.template, inner);

		const expanded =
			roots.length === 1 && roots[0]
				? roots[0]
				: this.syntheticStack(roots, "column", DEFAULT_GAP, node);
		// Use-site layout props, flags, data, and interaction land on the
		// expanded root so `ShowCard width=200 selected` behaves as expected.
		for (const [key, value] of Object.entries(layoutProps)) {
			expanded.props[key] = value;
		}
		this.applyLayoutProps(expanded);
		for (const flag of eff.flags) expanded.flags.add(flag);
		if (eff.data) expanded.data = eff.data;
		if (eff.interaction) expanded.interaction = eff.interaction;
		if (node.declaredId) expanded.source = node;
		return expanded;
	}

	private resolveBinding(value: string, ctx: BuildContext): string {
		if (value.startsWith("$")) {
			return ctx.bindings.get(value.slice(1)) ?? value;
		}
		return value;
	}

	private baseNode(
		kind: LKind,
		node: WireframeElementNode,
		eff: Effective,
	): LNode {
		const lnode: LNode = {
			kind,
			source: node,
			label: eff.label,
			placeholder: eff.placeholder,
			props: eff.attributes,
			flags: eff.flags,
			data: eff.data,
			interaction: eff.interaction,
			children: [],
			direction: "column",
			gap: DEFAULT_GAP,
			padding: 0,
			align: "stretch",
			justify: "start",
			title: node.componentName ?? node.nodeKind,
		};
		this.applyLayoutProps(lnode);
		return lnode;
	}

	private syntheticStack(
		children: LNode[],
		direction: Direction,
		gap: number,
		source?: WireframeElementNode,
	): LNode {
		return {
			kind: "stack",
			source: source ?? {
				id: "__synthetic__",
				type: "component",
				nodeKind: "component",
				attributes: {},
				flags: [],
			},
			label: "",
			placeholder: false,
			props: {},
			flags: new Set(),
			children,
			direction,
			gap,
			padding: 0,
			align: "stretch",
			justify: "start",
			title: "Stack",
		};
	}

	private applyLayoutProps(lnode: LNode): void {
		const p = lnode.props;
		lnode.direction = p.direction === "row" ? "row" : "column";
		lnode.gap = this.space(p.gap, lnode.gap);
		lnode.padding = this.space(p.padding, lnode.padding);
		lnode.align = isAlign(p.align) ? p.align : lnode.align;
		lnode.justify = isJustify(p.justify) ? p.justify : lnode.justify;
		lnode.width = this.sizing(p.width) ?? lnode.width;
		lnode.height = this.sizing(p.height) ?? lnode.height;
	}

	private space(value: string | undefined, fallback: number): number {
		if (value === undefined) return fallback;
		const named = SPACE[value];
		if (named !== undefined) return named;
		const n = Number.parseInt(value, 10);
		return Number.isFinite(n) ? n : fallback;
	}

	private sizing(value: string | undefined): Sizing | undefined {
		if (value === undefined) return undefined;
		if (value === "fill") return { kind: "fill" };
		if (value === "hug") return { kind: "hug" };
		const n = Number.parseInt(value, 10);
		return Number.isFinite(n) ? { kind: "fixed", px: n } : undefined;
	}

	/** The node's own declaration with overrides and param bindings applied. */
	private effective(node: WireframeElementNode, ctx: BuildContext): Effective {
		const attributes: Record<string, string> = { ...node.attributes };
		const flags = new Set(node.flags);
		let content = node.content;
		let data = node.data;
		let interaction =
			node.targetKind && node.target
				? { kind: node.targetKind, target: node.target }
				: undefined;

		const overrides = node.declaredId
			? (ctx.overrides.get(node.declaredId) ?? [])
			: [];
		for (const o of overrides) {
			if (o.content !== undefined) content = o.content;
			if (o.data !== undefined) data = o.data;
			Object.assign(attributes, o.attributes);
			for (const f of o.flags) flags.add(f);
			for (const f of o.clearFlags) flags.delete(f);
			if (o.targetKind && o.target) {
				interaction = { kind: o.targetKind, target: o.target };
			}
		}

		let label = content ?? "";
		let placeholder = false;
		if (content?.startsWith("$")) {
			const param = content.slice(1);
			const bound = ctx.bindings.get(param);
			if (bound !== undefined) {
				label = bound;
			} else {
				label = param ? param[0]?.toUpperCase() + param.slice(1) : "";
				placeholder = true;
			}
		}
		for (const [key, value] of Object.entries(attributes)) {
			if (value.startsWith("$")) {
				const bound = ctx.bindings.get(value.slice(1));
				if (bound !== undefined) attributes[key] = bound;
			}
		}

		return { label, placeholder, attributes, flags, data, interaction };
	}

	private adapterFor(
		ref: WireframeComponentRef | undefined,
	): WireframeLibraryComponentAdapter | undefined {
		if (!ref || ref.kind === "local") return undefined;
		return getWireframeLibraryAdapter(ref.module)?.components[ref.name];
	}

	// ─── Measure ───────────────────────────────────────────────────────────────

	/** Size the node takes when offered `availW`. `auto` is what the parent
	 * wants for a child that declares no width. Height is natural unless
	 * fixed; a parent distributes `fill` heights itself. */
	private measure(n: LNode, availW: number, auto: "fill" | "hug"): Size {
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
				return Math.min(160, availW);
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
			case "text": {
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
			case "box":
			case "custom": {
				if (n.children.length === 0) return 48;
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
					const row = this.rowSizes(n, innerW);
					return n.padding * 2 + row.maxH;
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

	/** Sizes of children laid side by side. Fill children share leftover
	 * width; if hugging children overflow, they shrink proportionally. */
	private rowSizes(
		n: LNode,
		innerW: number,
	): { sizes: Size[]; maxH: number; totalW: number } {
		const children = n.children;
		const gaps = Math.max(children.length - 1, 0) * n.gap;
		const widths: number[] = [];
		const fillers: number[] = [];
		let used = 0;
		children.forEach((child, i) => {
			const sizing = child.width ?? { kind: this.rowAuto(child) };
			if (sizing.kind === "fill") {
				fillers.push(i);
				widths.push(0);
				return;
			}
			const w = this.resolveWidth(child, innerW, "hug");
			widths.push(w);
			used += w;
		});

		if (fillers.length > 0) {
			const share = Math.max((innerW - used - gaps) / fillers.length, 24);
			for (const i of fillers) widths[i] = share;
		} else {
			const overflow = used + gaps - innerW;
			if (overflow > 0 && used > 0) {
				for (let i = 0; i < widths.length; i++) {
					const w = widths[i] ?? 0;
					widths[i] = Math.max(w - overflow * (w / used), 24);
				}
			}
		}

		const sizes = children.map((child, i) => {
			const w = widths[i] ?? 0;
			const h =
				child.height?.kind === "fixed"
					? child.height.px
					: this.naturalHeight(child, w);
			return { w, h };
		});
		const maxH = sizes.reduce((m, s) => Math.max(m, s.h), 0);
		const totalW = widths.reduce((sum, w) => sum + w, 0) + gaps;
		return { sizes, maxH, totalW };
	}

	// ─── Draw ──────────────────────────────────────────────────────────────────

	private draw(n: LNode, x: number, y: number, w: number, h: number): string {
		const inner = this.drawNode(n, x, y, w, h);
		const attrs: string[] = [];
		if (n.source.declaredId)
			attrs.push(`data-id="${svgEsc(n.source.declaredId)}"`);
		if (n.source.componentName)
			attrs.push(`data-component="${svgEsc(n.source.componentName)}"`);
		if (n.data) attrs.push(`data-ref="${svgEsc(n.data)}"`);
		if (n.interaction)
			attrs.push(
				`data-${n.interaction.kind}="${svgEsc(n.interaction.target)}"`,
			);
		if (n.flags.has("disabled")) attrs.push(`opacity="0.45"`);
		if (attrs.length === 0) return inner;
		return `<g ${attrs.join(" ")}>\n${inner}\n</g>`;
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
			const { sizes, totalW } = this.rowSizes(n, innerW);
			let cx =
				innerX + this.justifyOffset(n.justify, innerW, totalW, sizes.length);
			const extra = this.betweenExtra(n.justify, innerW, totalW, sizes.length);
			n.children.forEach((child, i) => {
				const s = sizes[i];
				if (!s) return;
				const stretch = n.align === "stretch" || child.height?.kind === "fill";
				const ch = stretch ? innerH : Math.min(s.h, innerH);
				const cy = innerY + this.alignOffset(n.align, innerH, ch);
				parts.push(this.draw(child, cx, cy, s.w, ch));
				cx += s.w + n.gap + extra;
			});
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
		const weight = this.fontWeight(n);
		const lines = this.wrap(n.label || " ", w, size, weight);
		const lineH = size * LINE_HEIGHT;
		const fill = n.placeholder || n.flags.has("muted") ? MUTED : INK;
		const style = n.placeholder ? ` font-style="italic"` : "";
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
					`<text x="${tx}" y="${round(y + i * lineH + size * 1.05)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${style}>${svgEsc(line)}</text>`,
			)
			.join("\n");
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
		const fill = primary ? INK : selected ? SURFACE : WHITE;
		const stroke = primary ? INK : INK;
		const text = primary ? WHITE : INK;
		const bh = Math.min(h, CONTROL_HEIGHT);
		const by = y + (h - bh) / 2;
		return [
			`<rect x="${x}" y="${round(by)}" width="${w}" height="${bh}" rx="${CONTROL_RADIUS}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
			`<text x="${x + w / 2}" y="${round(by + bh / 2 + size * 0.35)}" font-size="${size}" font-weight="600" fill="${text}" text-anchor="middle">${svgEsc(this.ellipsize(label, w - 16, size, 600))}</text>`,
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
				`<text x="${x + 12}" y="${round(fy + CONTROL_HEIGHT / 2 + 5)}" font-size="${FONT.md}" fill="${value ? INK : MUTED}">${svgEsc(this.ellipsize(shown, textW, FONT.md ?? 14))}</text>`,
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
				`<rect x="${x}" y="${y + 2}" width="${CHOICE_SIZE}" height="${CHOICE_SIZE}" rx="3" fill="${checked ? INK : WHITE}" stroke="${checked ? INK : INK_SOFT}" stroke-width="1.2"/>`,
			);
			if (checked) {
				parts.push(
					`<path d="M ${x + 3.5} ${y + 10} L ${x + 7} ${y + 13.5} L ${x + 12.5} ${y + 6}" fill="none" stroke="${WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
				);
			}
		} else {
			parts.push(
				`<circle cx="${x + CHOICE_SIZE / 2}" cy="${cy}" r="${CHOICE_SIZE / 2}" fill="${WHITE}" stroke="${checked ? INK : INK_SOFT}" stroke-width="1.2"/>`,
			);
			if (checked) {
				parts.push(
					`<circle cx="${x + CHOICE_SIZE / 2}" cy="${cy}" r="${CHOICE_SIZE / 2 - 4}" fill="${INK}"/>`,
				);
			}
		}
		parts.push(
			`<text x="${x + CHOICE_SIZE + 8}" y="${round(cy + size * 0.35)}" font-size="${size}" fill="${n.placeholder ? MUTED : INK}">${svgEsc(this.ellipsize(label, w - CHOICE_SIZE - 8, size))}</text>`,
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
				`<circle cx="${px}" cy="${cy}" r="${r}" fill="${INK}"/>`,
				`<path d="M ${px - 3} ${cy - 5} L ${px + 5} ${cy} L ${px - 3} ${cy + 5} Z" fill="${WHITE}"/>`,
				`<line x1="${px + 20}" y1="${cy}" x2="${x + w - 16}" y2="${cy}" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>`,
				`<line x1="${px + 20}" y1="${cy}" x2="${px + 20 + (w - 56) * 0.35}" y2="${cy}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
			);
		} else if (n.kind === "video") {
			const r = Math.min(20, h * 0.25);
			parts.push(
				`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}"/>`,
				`<path d="M ${cx - r * 0.3} ${cy - r * 0.5} L ${cx + r * 0.5} ${cy} L ${cx - r * 0.3} ${cy + r * 0.5} Z" fill="${WHITE}"/>`,
			);
		} else {
			const s = Math.min(40, h * 0.5, w * 0.5);
			const ix = cx - s / 2;
			const iy = cy - s / 2;
			parts.push(
				`<rect x="${ix}" y="${iy}" width="${s}" height="${s}" rx="3" fill="none" stroke="${MUTED}" stroke-width="1.5"/>`,
				`<circle cx="${ix + s * 0.3}" cy="${iy + s * 0.3}" r="${s * 0.09}" fill="${MUTED}"/>`,
				`<path d="M ${ix + s * 0.08} ${iy + s * 0.85} L ${ix + s * 0.38} ${iy + s * 0.5} L ${ix + s * 0.58} ${iy + s * 0.72} L ${ix + s * 0.7} ${iy + s * 0.6} L ${ix + s * 0.92} ${iy + s * 0.85}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-linejoin="round"/>`,
			);
		}
		if (n.label) {
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
					`<rect x="${round(x + i * colW + 12)}" y="${ry + 12}" width="${round(barW)}" height="8" rx="4" fill="${SURFACE}"/>`,
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
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${WHITE}" stroke="${INK}" stroke-width="1.2"/>`,
		];
		let cy = y + pad;
		if (n.label) {
			const size = FONT.lg ?? 18;
			parts.push(
				`<text x="${x + pad}" y="${round(cy + size * 1.05)}" font-size="${size}" font-weight="700" fill="${n.placeholder ? MUTED : INK}">${svgEsc(this.ellipsize(n.label, w - pad * 2, size, 700))}</text>`,
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

	private asciiNode(n: LNode, depth: number): string[] {
		const indent = "  ".repeat(depth);
		const id = n.source.declaredId ? ` #${n.source.declaredId}` : "";
		const flags = [...n.flags].filter((f) => f !== "hidden");
		const flagText = flags.length > 0 ? ` (${flags.join(", ")})` : "";
		const data = n.data ? ` data=${n.data}` : "";
		const interaction = n.interaction
			? ` -->|${n.interaction.kind}| ${n.interaction.target}`
			: "";
		const tail = `${id}${data}${flagText}${interaction}`;
		const label = n.placeholder ? `{${n.label}}` : n.label;

		if (n.kind === "stack") {
			if (n.repeatCount && n.repeatItem) {
				return [
					`${indent}repeat x${n.repeatCount} ${n.direction}${tail}`,
					...this.asciiNode(n.repeatItem, depth + 1),
				];
			}
			const head =
				n.source.componentName === "Stack" || n.source.id === "__synthetic__"
					? `${indent}${n.direction}${tail}`
					: `${indent}${n.direction} ${n.source.componentName ?? ""}${tail}`;
			return [head, ...n.children.flatMap((c) => this.asciiNode(c, depth + 1))];
		}

		if (n.kind === "custom" && n.adapter?.renderAscii) {
			return [
				`${indent}${n.adapter.renderAscii({ ast: this.ast, node: n.source, label: n.label || n.title })}${tail}`,
			];
		}

		if (n.kind === "box" || n.kind === "custom") {
			const head = `${indent}${n.title}${tail}`;
			return [head, ...n.children.flatMap((c) => this.asciiNode(c, depth + 1))];
		}

		let head: string;
		switch (n.kind) {
			case "text":
				head = `${indent}text "${label}"`;
				break;
			case "input":
			case "select":
				head =
					`${indent}[${n.kind}] ${label || n.props.placeholder || n.props.label || ""}`.trimEnd();
				break;
			case "table":
				head = `${indent}[table] ${this.tableColumns(n).join(" | ")}`;
				break;
			default:
				head = `${indent}[${n.kind}] ${label}`.trimEnd();
		}
		return [
			`${head}${tail}`,
			...n.children.flatMap((c) => this.asciiNode(c, depth + 1)),
		];
	}

	// ─── Text + prop helpers ───────────────────────────────────────────────────

	private fontSize(n: LNode): number {
		const named = n.props.size ? FONT[n.props.size] : undefined;
		if (named !== undefined) return named;
		const parsed = Number.parseInt(n.props.size ?? "", 10);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
		return FONT.md ?? 14;
	}

	private fontWeight(n: LNode): number {
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

	private tableColumns(n: LNode): string[] {
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
		return n.source.declaredId ? `${n.title} #${n.source.declaredId}` : n.title;
	}

	/** Approximate glyph advance for the system sans stack. */
	private textWidth(text: string, size: number, weight = 400): number {
		const factor = weight >= 600 ? 0.58 : 0.54;
		return text.length * size * factor;
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
	data?: string;
	interaction?: { kind: WireframeInteractionKind; target: string };
};

function isAlign(value: string | undefined): value is Align {
	return (
		value === "start" ||
		value === "center" ||
		value === "end" ||
		value === "stretch"
	);
}

function isJustify(value: string | undefined): value is Justify {
	return (
		value === "start" ||
		value === "center" ||
		value === "end" ||
		value === "between"
	);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
