import { PADDING_OUTER, TITLE_HEIGHT } from "./style.ts";
import { svgRoot } from "./svg.ts";
import type { DiagramAST } from "./types.ts";

/**
 * Abstract base class for all diagram renderers.
 *
 * `render()` is a template method — it always produces the standard SVG
 * envelope (root element, shared `<style>`, optional `<defs>`). Subclasses
 * declare `width` and `height` as readonly fields (typically populated in
 * the constructor) and implement `renderBody()`; `renderDefs()` and
 * `extraTextStyles()` have empty defaults that subclasses can override.
 */
export abstract class DiagramRenderer<AST extends DiagramAST = DiagramAST> {
	protected ast: AST;

	/** Overall SVG width. Subclass populates in its constructor (or as a getter). */
	protected abstract readonly width: number;

	/** Overall SVG height. Subclass populates in its constructor (or as a getter). */
	protected abstract readonly height: number;

	constructor(ast: AST) {
		this.ast = ast;
	}

	/** Final — orchestrates the standard SVG envelope. Subclasses do not
	 * override this; they declare `width`/`height` and implement `renderBody()`. */
	render(): string {
		return svgRoot({
			width: this.width,
			height: this.height,
			body: this.renderBody(),
			defs: this.renderDefs(),
			extraTextStyles: this.extraTextStyles(),
		});
	}

	/** Subclass hook — body content inside the `<svg>` envelope, excluding
	 * the shared `<style>` block and the optional `<defs>` block. */
	protected abstract renderBody(): string;

	/** Subclass hook — optional `<defs>` contents (arrow markers, gradients).
	 * Default: empty. */
	protected renderDefs(): string {
		return "";
	}

	/** Subclass hook — additional CSS appended to the shared `text` rule.
	 * Default: empty. */
	protected extraTextStyles(): string {
		return "";
	}

	/** Produce canonical plaintext for the diagram. */
	abstract toPlaintext(): string;

	// ─── Shared AST-coupled helpers ──────────────────────────────────────────

	/** True if the AST carries a renderable title. */
	protected hasTitle(): boolean {
		return Boolean(this.ast.title || this.ast.accTitle);
	}

	/** Effective title text — `title` falls back to `accTitle` for accessibility. */
	protected titleText(): string | undefined {
		return this.ast.title || this.ast.accTitle;
	}

	/** Standard top offset for placing diagram content below the optional
	 * title strip. */
	protected topOffset(): number {
		return PADDING_OUTER + (this.hasTitle() ? TITLE_HEIGHT : 0);
	}
}
