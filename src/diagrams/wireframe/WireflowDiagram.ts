import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { WireflowParser } from "./WireflowParser.ts";
import { WireflowRenderer } from "./WireflowRenderer.ts";
import { wireflowToPlaintext } from "./wireframeToPlaintext.ts";
import type { WireflowAST } from "./wireframeTypes.ts";

export class WireflowDiagram extends Diagram<WireflowAST> {
	readonly type = "wireflow";
	readonly name = "Wireflow";

	detect(firstLine: string): boolean {
		return /^wireflow\b/i.test(firstLine);
	}

	parse(tokens: Token[]): ParseResult<WireflowAST> {
		return new WireflowParser(tokens).parse();
	}

	render(ast: WireflowAST): string {
		return new WireflowRenderer(ast).render();
	}

	toPlaintext(ast: WireflowAST): string {
		return wireflowToPlaintext(ast);
	}
}
