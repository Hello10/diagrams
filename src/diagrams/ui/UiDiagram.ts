import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { UiParser } from "./UiParser.ts";
import { UiStoryboardRenderer } from "./UiStoryboardRenderer.ts";
import { uiToPlaintext } from "./uiToPlaintext.ts";
import type { UiAST } from "./uiTypes.ts";

/** The UI diagram. `render()` draws the storyboard; `renderUiFlow()` in
 * this module's index draws the flow overview alone. */
export class UiDiagram extends Diagram<UiAST> {
	readonly type = "ui";
	readonly name = "UI";

	detect(firstLine: string): boolean {
		return /^ui\b/i.test(firstLine);
	}

	parse(tokens: Token[]): ParseResult<UiAST> {
		return new UiParser(tokens).parse();
	}

	render(ast: UiAST): string {
		return new UiStoryboardRenderer(ast).render();
	}

	toPlaintext(ast: UiAST): string {
		return uiToPlaintext(ast);
	}
}
