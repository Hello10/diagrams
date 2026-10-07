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
		return firstLine.toLowerCase().startsWith("wireframe");
	}

	parse(tokens: Token[]): ParseResult<WireframeAST> {
		const parser = new WireframeParser(tokens);
		const result = parser.parse();
		if (result.ok && result.ast.type === "wireframe") {
			return { ok: true, ast: result.ast as WireframeAST };
		}
		if (!result.ok) {
			const partialAst =
				result.partialAst?.type === "wireframe"
					? (result.partialAst as WireframeAST)
					: undefined;
			return { ok: false, errors: result.errors, partialAst };
		}
		return {
			ok: false,
			errors: [
				{
					message: "Expected wireframe AST",
					line: 1,
					col: 1,
					severity: "error",
				},
			],
		};
	}

	render(ast: WireframeAST): string {
		return new WireframeRenderer(ast).render();
	}

	toPlaintext(ast: WireframeAST): string {
		return wireframeToPlaintext(ast);
	}
}
