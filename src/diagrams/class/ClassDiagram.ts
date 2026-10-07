import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { ClassParser } from "./ClassParser.ts";
import { ClassRenderer } from "./ClassRenderer.ts";
import type { ClassDiagramAST } from "./classTypes.ts";

export class ClassDiagram extends Diagram<ClassDiagramAST> {
	readonly type = "classDiagram";
	readonly name = "Class Diagram";

	detect(firstLine: string): boolean {
		const l = firstLine.trim().toLowerCase();
		return l === "classdiagram" || l === "class";
	}

	parse(tokens: Token[], source?: string): ParseResult<ClassDiagramAST> {
		const parser = new ClassParser(tokens);
		if (source) parser.setSource(source.split("\n"));
		return parser.parse();
	}

	render(ast: ClassDiagramAST): string {
		return new ClassRenderer(ast).render();
	}

	toPlaintext(ast: ClassDiagramAST): string {
		return new ClassRenderer(ast).toPlaintext();
	}
}
