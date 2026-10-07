import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { WireframeParser } from "./WireframeParser.ts";
import { wireflowToPlaintext } from "./wireframeToPlaintext.ts";
import type { WireflowAST } from "./wireframeTypes.ts";

export class WireflowDiagram extends Diagram<WireflowAST> {
	readonly type = "wireflow";
	readonly name = "Wireflow";

	detect(firstLine: string): boolean {
		return firstLine.toLowerCase().startsWith("wireflow");
	}

	parse(tokens: Token[]): ParseResult<WireflowAST> {
		const parser = new WireframeParser(tokens);
		const result = parser.parse();
		if (result.ok && result.ast.type === "wireflow") {
			return { ok: true, ast: result.ast as WireflowAST };
		}
		if (!result.ok) {
			const partialAst =
				result.partialAst?.type === "wireflow"
					? (result.partialAst as WireflowAST)
					: undefined;
			return { ok: false, errors: result.errors, partialAst };
		}
		return {
			ok: false,
			errors: [
				{
					message: "Expected wireflow AST",
					line: 1,
					col: 1,
					severity: "error",
				},
			],
		};
	}

	render(_ast: WireflowAST): string {
		return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="100" y="50" text-anchor="middle">Wireflow Map Renderer</text></svg>`;
	}

	toPlaintext(ast: WireflowAST): string {
		return wireflowToPlaintext(ast);
	}
}
