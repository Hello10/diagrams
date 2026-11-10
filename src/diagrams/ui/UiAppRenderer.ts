import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { svgEsc } from "../../svg.ts";
import { UiFlowRenderer } from "./UiFlowRenderer.ts";
import {
	CANVAS_PAD,
	FONT,
	INK,
	SECTION_GAP,
	TIER_GAP,
	TIER_HEADING_H,
} from "./uiFrame.ts";
import { TIER_RULE_END, UiStoryboardRenderer } from "./UiStoryboardRenderer.ts";
import { uiToPlaintext } from "./uiToPlaintext.ts";
import type { UiAppAST, UiAST } from "./uiTypes.ts";

/** Height of a document's heading in the set drawing. */
const DOCUMENT_HEADING_H = 56;

/**
 * The storyboard of a set of documents: the flow across every document,
 * then each document as a group under its module name, with its layouts,
 * screens, and components in its own words and theme. The flow is drawn
 * in the entry document's theme.
 */
export class UiAppRenderer extends DiagramRenderer<UiAppAST> {
	private built?: { width: number; height: number; body: string };
	private readonly lead: UiAST | undefined;
	private readonly boards: { module: string; board: UiStoryboardRenderer }[];

	constructor(app: UiAppAST) {
		super(app);
		this.lead =
			(app.entry ? app.documents[app.entry.module] : undefined) ??
			app.documents[app.order[0] ?? ""];
		this.boards = app.order.flatMap((module) => {
			const ast = app.documents[module];
			return ast
				? [{ module, board: new UiStoryboardRenderer({ ast, app }) }]
				: [];
		});
	}

	private drawing(): { width: number; height: number; body: string } {
		if (!this.built) this.built = this.build();
		return this.built;
	}

	protected get width(): number {
		return this.drawing().width;
	}

	protected get height(): number {
		return this.drawing().height;
	}

	protected renderBody(): string {
		return this.drawing().body;
	}

	protected override renderDefs(): string {
		return this.boards[0]?.board.engine.frameDefs() ?? "";
	}

	protected override extraTextStyles(): string {
		return "cursor: default; user-select: none;";
	}

	/** Every document's canonical source, each under a comment naming its
	 * module. */
	toPlaintext(): string {
		return this.ast.order
			.map((module) => {
				const doc = this.ast.documents[module];
				return doc ? `%% ${module}\n${uiToPlaintext(doc)}` : "";
			})
			.filter(Boolean)
			.join("\n\n");
	}

	private build(): { width: number; height: number; body: string } {
		const parts: string[] = [];
		let cy = CANVAS_PAD;
		let right = 0;

		if (this.lead) {
			const flow = new UiFlowRenderer({
				ast: this.lead,
				app: this.ast,
			}).inline();
			if (flow.svg) {
				parts.push(tierHeading("Flow", CANVAS_PAD, cy));
				cy += TIER_HEADING_H;
				parts.push(
					`<g transform="translate(${CANVAS_PAD}, ${cy})">${flow.svg}</g>`,
				);
				cy += flow.height + SECTION_GAP;
				right = Math.max(right, CANVAS_PAD + flow.width);
			}
		}

		for (const { module, board } of this.boards) {
			if (cy > CANVAS_PAD) cy += TIER_GAP - SECTION_GAP;
			parts.push(documentHeading(module, CANVAS_PAD, cy));
			cy += DOCUMENT_HEADING_H;
			const tiers = board.tiers({ y0: cy, first: true });
			parts.push(tiers.svg);
			cy = tiers.bottom;
			right = Math.max(right, tiers.right);
		}

		const width = Math.max(right + CANVAS_PAD, 320);
		return {
			width,
			height: Math.max(cy - SECTION_GAP + CANVAS_PAD, 160),
			body: parts
				.join("\n")
				.replaceAll(TIER_RULE_END, String(width - CANVAS_PAD)),
		};
	}
}

function tierHeading(text: string, x: number, y: number): string {
	return [
		`<text x="${x}" y="${y + 20}" font-size="${FONT.xl}" font-weight="700" fill="${INK}">${svgEsc(text)}</text>`,
		`<line x1="${x}" y1="${y + 32}" x2="${TIER_RULE_END}" y2="${y + 32}" stroke="#d1d5db" stroke-width="1"/>`,
	].join("\n");
}

/** A document's heading: its module string, over a heavier rule than a
 * tier's. */
function documentHeading(module: string, x: number, y: number): string {
	return [
		`<g data-document="${svgEsc(module)}">`,
		`<text x="${x}" y="${y + 24}" font-size="${FONT.xxl}" font-weight="700" fill="${INK}">${svgEsc(module)}</text>`,
		`<line x1="${x}" y1="${y + 38}" x2="${TIER_RULE_END}" y2="${y + 38}" stroke="${INK}" stroke-width="2"/>`,
		"</g>",
	].join("\n");
}
