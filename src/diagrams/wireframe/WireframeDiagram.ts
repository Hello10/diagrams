import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { WireframeParser } from "./WireframeParser.ts";
import { WireframeRenderer } from "./WireframeRenderer.ts";
import { wireframeToPlaintext } from "./wireframeToPlaintext.ts";
import type { WireframeAST } from "./wireframeTypes.ts";

export class WireframeDiagram extends Diagram<WireframeAST> {
	readonly type = "wireframe";
	readonly name = "Wireframe";

	detect(firstLine: string): boolean {
		return /^wireframe\b/i.test(firstLine);
	}

	parse(tokens: Token[]): ParseResult<WireframeAST> {
		return new WireframeParser(tokens).parse();
	}

	render(ast: WireframeAST): string {
		return new WireframeRenderer(ast).render();
	}

	toPlaintext(ast: WireframeAST): string {
		return wireframeToPlaintext(ast);
	}
}
