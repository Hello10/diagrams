import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { SequenceParser } from "./SequenceParser.ts";
import { SequenceRenderer } from "./SequenceRenderer.ts";
import type { SequenceDiagramAST } from "./sequenceTypes.ts";

export class SequenceDiagram extends Diagram<SequenceDiagramAST> {
	readonly type = "sequenceDiagram";
	readonly name = "Sequence Diagram";

	detect(firstLine: string): boolean {
		const l = firstLine.trim().toLowerCase();
		return l === "sequencediagram" || l === "sequence";
	}

	parse(tokens: Token[], source?: string): ParseResult<SequenceDiagramAST> {
		const parser = new SequenceParser(tokens);
		if (source) parser.setSource(source.split("\n"));
		return parser.parse();
	}

	render(ast: SequenceDiagramAST): string {
		return new SequenceRenderer(ast).render();
	}

	toPlaintext(ast: SequenceDiagramAST): string {
		return new SequenceRenderer(ast).toPlaintext();
	}
}
