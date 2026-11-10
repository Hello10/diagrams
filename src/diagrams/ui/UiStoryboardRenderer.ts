import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { FONT_MONO } from "../../style.ts";
import { svgEsc } from "../../svg.ts";
import { renderUiAsciiText } from "./uiAscii.ts";
import { walkTree } from "./uiCallouts.ts";
import { UiFlowRenderer } from "./UiFlowRenderer.ts";
import {
	BADGE_R,
	CANVAS_PAD,
	CAPTION_HEIGHT,
	COMPONENT_WIDTH,
	EXIT_LINE_H,
	FONT,
	FRAME_GAP,
	frameViews,
	GRAPH_GAP,
	INK,
	INK_SOFT,
	LINE,
	MUTED,
	rowCallouts,
	SCREEN_WIDTH,
	SECTION_GAP,
	SECTION_HEADING_H,
	TIER_GAP,
	TIER_HEADING_H,
	UiFrameEngine,
	type UiView,
	viewLabel,
} from "./uiFrame.ts";
import { targetId, targetLabel, UiScope } from "./uiScope.ts";
import {
	modeTransitions,
	renderStatechart,
	statechartAst,
} from "./uiStatechart.ts";
import { uiToPlaintext } from "./uiToPlaintext.ts";
import type { UiAppAST, UiAST, UiComponent, UiNode } from "./uiTypes.ts";

/** Placeholder for a tier rule's right end, filled in once the drawing's
 * width is known. */
export const TIER_RULE_END = "__TIER_RULE_END__";

/**
 * The storyboard: one drawing of a UI document in three tiers. The flow
 * overview; then the screens, each a section (mode chart when it has
 * modes, then one frame per view with numbered callouts); then the
 * components, each a section the same way at component width, labeled with
 * where it is first embedded. Composes the frame engine, the statechart,
 * and the flow renderer; owns none of their logic.
 */
export class UiStoryboardRenderer extends DiagramRenderer<UiAST> {
	readonly engine: UiFrameEngine;
	private readonly scope: UiScope;
	private built?: { width: number; height: number; body: string };

	/** With `app`, the document is drawn as one of a set: its instances of
	 * imported components expand, and the components tier lists where in
	 * the whole app each of its components is first embedded. */
	constructor({ ast, app }: { ast: UiAST; app?: UiAppAST }) {
		super(ast);
		this.scope = new UiScope({ ast, app });
		this.engine = new UiFrameEngine({ ast, app });
	}

	/** One component in one view, drawn at the origin without a caption. */
	renderFrame(
		name: string,
		view?: UiView,
	): { svg: string; width: number; height: number } | undefined {
		return this.engine.renderFrame(name, view);
	}

	/** Text rendering of the same expanded trees the SVG draws. */
	renderAscii(): string {
		return renderUiAsciiText(this.ast, this.engine);
	}

	/** The storyboard is built on first use, not in the constructor, so the
	 * flow renderer can instantiate this class for thumbnails without
	 * building (and recursing into) the storyboard. */
	private storyboard(): { width: number; height: number; body: string } {
		if (!this.built) this.built = this.buildStoryboard();
		return this.built;
	}

	protected get width(): number {
		return this.storyboard().width;
	}

	protected get height(): number {
		return this.storyboard().height;
	}

	protected renderBody(): string {
		return this.storyboard().body;
	}

	protected override renderDefs(): string {
		return this.engine.frameDefs();
	}

	protected override extraTextStyles(): string {
		return "cursor: default; user-select: none;";
	}

	toPlaintext(): string {
		return uiToPlaintext(this.ast);
	}

	/** One drawing: the flow overview, then every screen, then every
	 * component (once, labeled with the first screen that embeds it). */
	private buildStoryboard(): { width: number; height: number; body: string } {
		const parts: string[] = [];
		let cy = CANVAS_PAD;
		let right = 0;
		const flow = new UiFlowRenderer({ ast: this.ast }).inline();
		if (flow.svg) {
			parts.push(this.tierHeading("Flow", CANVAS_PAD, cy));
			cy += TIER_HEADING_H;
			parts.push(
				`<g transform="translate(${CANVAS_PAD}, ${cy})">${flow.svg}</g>`,
			);
			cy += flow.height + SECTION_GAP;
			right = Math.max(right, CANVAS_PAD + flow.width);
		}
		const tiers = this.tiers({ y0: cy, first: !flow.svg });
		parts.push(tiers.svg);
		cy = tiers.bottom;
		right = Math.max(right, tiers.right);

		const width = Math.max(right + CANVAS_PAD, 320);
		return {
			width,
			height: Math.max(cy - SECTION_GAP + CANVAS_PAD, 160),
			// Tier rules span the drawing, whose width is known only now.
			body: parts
				.join("\n")
				.replaceAll(TIER_RULE_END, String(width - CANVAS_PAD)),
		};
	}

	/** The document's frames: its layouts, screens, and components as
	 * tiers from `y0` down. `bottom` is SECTION_GAP below the last row.
	 * Tier rules end at `TIER_RULE_END`, for the caller to fill in once
	 * the drawing's width is known. With `first`, the first tier gets no
	 * gap above it. */
	tiers({ y0, first = false }: { y0: number; first?: boolean }): {
		svg: string;
		bottom: number;
		right: number;
	} {
		const parts: string[] = [];
		let cy = y0;
		let right = 0;
		// Every tier ends SECTION_GAP below its last row; the next tier's
		// heading sits TIER_GAP below that row.
		let tiers = first ? 0 : 1;
		const tier = (title: string) => {
			if (tiers > 0) cy += TIER_GAP - SECTION_GAP;
			tiers++;
			parts.push(this.tierHeading(title, CANVAS_PAD, cy));
			cy += TIER_HEADING_H;
		};

		// Layouts first: the common frame every wrapped screen shares, with
		// its actions listed once, here. Then screens, in declaration order,
		// each drawn inside its layout dimmed. Each component is listed for
		// the components tier under the first layout or screen that embeds
		// it, anywhere in scope.
		const layouts = this.ast.order.filter(
			(name) => this.ast.components[name]?.isLayout,
		);
		const screens = this.ast.order.filter(
			(name) => this.ast.components[name]?.route !== undefined,
		);
		if (layouts.length > 0) tier("Layouts");
		for (const name of layouts) {
			const layout = this.ast.components[name];
			if (!layout) continue;
			const row = this.viewRow(
				layout,
				SCREEN_WIDTH,
				name,
				"layout",
				CANVAS_PAD,
				cy,
			);
			parts.push(row.svg);
			cy += row.height + SECTION_GAP;
			right = Math.max(right, row.right);
		}
		if (screens.length > 0) tier("Screens");
		for (const name of screens) {
			const screen = this.ast.components[name];
			if (!screen) continue;
			const row = this.viewRow(
				screen,
				SCREEN_WIDTH,
				name,
				screen.route ?? "",
				CANVAS_PAD,
				cy,
			);
			parts.push(row.svg);
			cy += row.height + SECTION_GAP;
			right = Math.max(right, row.right);
		}

		const components = this.componentsTier();
		if (components.length > 0) {
			tier("Components");
			for (const { component, where } of components) {
				const row = this.viewRow(
					component,
					COMPONENT_WIDTH,
					component.name,
					where,
					CANVAS_PAD,
					cy,
				);
				parts.push(row.svg);
				cy += row.height + SECTION_GAP;
				right = Math.max(right, row.right);
			}
		}

		return { svg: parts.join("\n"), bottom: cy, right };
	}

	/** This document's components in the order they are first met walking
	 * every layout and screen in scope, each with where that was; then
	 * those nothing embeds. */
	private componentsTier(): { component: UiComponent; where: string }[] {
		const where = this.embeddings();
		const out: { component: UiComponent; where: string }[] = [];
		const listed = new Set<string>();
		for (const [id, entry] of where) {
			if (entry.doc !== this.ast) continue;
			listed.add(id);
			out.push({ component: entry.component, where: entry.where });
		}
		for (const name of this.ast.order) {
			const component = this.ast.components[name];
			const id = targetId({ name }, this.ast);
			if (
				!component ||
				component.route !== undefined ||
				component.isLayout ||
				listed.has(id)
			)
				continue;
			listed.add(id);
			out.push({ component, where: "not embedded by any screen" });
		}
		return out;
	}

	/** A tier heading: Flow, Screens, Components. Larger than a section
	 * heading, with a rule under it spanning the drawing. */
	private tierHeading(text: string, x: number, y: number): string {
		return [
			`<text x="${x}" y="${y + 20}" font-size="${FONT.xl}" font-weight="700" fill="${INK}">${svgEsc(text)}</text>`,
			`<line x1="${x}" y1="${y + 32}" x2="${TIER_RULE_END}" y2="${y + 32}" stroke="${LINE}" stroke-width="1"/>`,
		].join("\n");
	}

	private sectionHeading(
		text: string,
		x: number,
		y: number,
		sub?: string,
	): string {
		const parts = [
			`<text x="${x}" y="${y + 16}" font-size="${FONT.lg}" font-weight="700" fill="${INK}">${svgEsc(text)}</text>`,
		];
		if (sub) {
			parts.push(
				`<text x="${x + this.engine.textWidth(text, FONT.lg ?? 18, 700) + 12}" y="${y + 16}" font-family="${FONT_MONO}" font-size="${FONT.sm}" fill="${MUTED}">${svgEsc(sub)}</text>`,
			);
		}
		return parts.join("\n");
	}

	/** Every component embedded by a layout or screen in scope,
	 * transitively, keyed by id in the order first met, with where that
	 * was: the component whose tree holds the instance (qualified by its
	 * module when it is in another document), the mode that part of the
	 * tree is in, and whether it is in a modal (`in AlbumCard @listening,
	 * modal`). Layouts of every document come first, then screens, in
	 * declaration order. */
	private embeddings(): Map<
		string,
		{ doc: UiAST; component: UiComponent; where: string }
	> {
		const out = new Map<
			string,
			{ doc: UiAST; component: UiComponent; where: string }
		>();
		const seen = new Set<string>();
		const visit = (ownerDoc: UiAST, owner: UiComponent) => {
			walkTree(owner.tree, (node, mode) => {
				if (node.ref?.kind !== "component") return;
				const childDoc = this.scope.document(node.ref.module, ownerDoc);
				if (!childDoc) return;
				const id = targetId({ name: node.ref.name }, childDoc);
				if (seen.has(id)) return;
				seen.add(id);
				const child = childDoc.components[node.ref.name];
				if (!child) return;
				const modal = inModalOf(owner.tree, node);
				const ownerName =
					ownerDoc === this.ast
						? owner.name
						: targetLabel({ module: ownerDoc.module, name: owner.name });
				out.set(id, {
					doc: childDoc,
					component: child,
					where: `in ${ownerName}${mode === undefined ? "" : ` @${mode}`}${modal ? ", modal" : ""}`,
				});
				visit(childDoc, child);
			});
		};
		const docs = this.scope.documents();
		const roots = (pick: (c: UiComponent) => boolean) =>
			docs.flatMap((doc) =>
				doc.order.flatMap((name) => {
					const c = doc.components[name];
					return c && pick(c) ? [{ doc, component: c }] : [];
				}),
			);
		for (const { doc, component } of [
			...roots((c) => c.isLayout === true),
			...roots((c) => c.route !== undefined),
		]) {
			seen.add(targetId({ name: component.name }, doc));
			visit(doc, component);
		}
		return out;
	}

	/** A component's views as a row of frames. Element-fired actions become
	 * numbered callouts: a badge on the element in the frame, and a legend
	 * line under it. A component with modes gets its mode chart above. */
	private viewRow(
		component: UiComponent,
		width: number,
		heading: string,
		sub: string,
		x0: number,
		y0: number,
	): { svg: string; height: number; right: number } {
		const views = frameViews(component, this.ast);
		const frames = views.map((v) =>
			this.engine.buildFrame(component, v, width),
		);
		const frameH = Math.max(...frames.map((f) => f.height));
		const callouts = rowCallouts(frames);

		const parts: string[] = [this.sectionHeading(heading, x0, y0, sub)];
		let cy = y0 + SECTION_HEADING_H;

		// The mode chart, drawn by the state diagram renderer.
		if (component.modes.length > 1) {
			const transitions = modeTransitions(component);
			if (transitions.length > 0) {
				const graph = renderStatechart(statechartAst(component, transitions));
				parts.push(`<g transform="translate(${x0}, ${cy})">${graph.svg}</g>`);
				cy += graph.height + GRAPH_GAP;
			}
		}

		const captioned = views.some((v) => viewLabel(v) !== "");
		const frameTop = cy + (captioned ? CAPTION_HEIGHT : 0);
		// Each frame's legend sits directly under that frame, not under the
		// row's tallest one. The row is as tall as its tallest frame-plus-legend.
		const listTopOf = (i: number) => frameTop + (frames[i]?.height ?? 0) + 20;
		const rowBottom = Math.max(
			frameTop + frameH,
			...frames.map(
				(_, i) => listTopOf(i) + (callouts[i]?.length ?? 0) * EXIT_LINE_H,
			),
		);
		const totalH = rowBottom - y0;
		const frameX = (i: number) => x0 + i * (width + FRAME_GAP);

		frames.forEach((frame, i) => {
			const fx = frameX(i);
			const label = viewLabel(frame.view);
			if (label) {
				parts.push(
					`<text x="${fx}" y="${frameTop - 9}" font-family="${FONT_MONO}" font-size="${FONT.sm}" fill="${INK_SOFT}">${svgEsc(label)}</text>`,
				);
			}
			const list = callouts[i] ?? [];
			this.engine.activeCallouts = new Map(
				list.map((c, k) => [c.origin, k + 1] as const),
			);
			parts.push(this.engine.drawFrameBody(frame, fx, frameTop));
			this.engine.activeCallouts = new Map();
			for (const [k, c] of list.entries()) {
				const ly = listTopOf(i) + 12 + k * EXIT_LINE_H;
				parts.push(
					this.engine.badge(fx + BADGE_R, ly - 4, k + 1),
					`<text x="${fx + BADGE_R * 2 + 10}" y="${ly}" font-family="${FONT_MONO}" font-size="${FONT.sm}" fill="${INK_SOFT}">${svgEsc(c.event)} → ${svgEsc(c.action)}</text>`,
				);
			}
		});

		return {
			svg: parts.join("\n"),
			height: totalH,
			right: frameX(views.length - 1) + width,
		};
	}
}

/** Is `target` under a `modal` somewhere in `nodes`? */
function inModalOf(nodes: UiNode[], target: UiNode): boolean {
	let hit = false;
	const visit = (list: UiNode[], modal: boolean) => {
		for (const n of list) {
			if (hit) return;
			if (n === target) {
				hit = modal;
				return;
			}
			const inner = modal || n.kind === "modal";
			if (n.kind === "when") {
				for (const k of n.cases ?? []) visit(k.nodes, inner);
			} else visit(n.children, inner);
		}
	};
	visit(nodes, false);
	return hit;
}
