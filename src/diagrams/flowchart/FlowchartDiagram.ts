import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { FlowchartParser } from "./FlowchartParser.ts";
import { FlowchartRenderer } from "./FlowchartRenderer.ts";
import type { FlowchartAST } from "./flowchartTypes.ts";

export class FlowchartDiagram extends Diagram<FlowchartAST> {
	readonly type = "flowchart";
	readonly name = "Flowchart";

	detect(firstLine: string): boolean {
		const head = firstLine.trim().split(/\s+/)[0]?.toLowerCase();
		return head === "flowchart" || head === "graph";
	}

	parse(tokens: Token[], source?: string): ParseResult<FlowchartAST> {
		const parser = new FlowchartParser(tokens);
		if (source) parser.setSource(source.split("\n"));
		return parser.parse();
	}

	render(ast: FlowchartAST): string {
		return new FlowchartRenderer(ast).render();
	}

	toPlaintext(ast: FlowchartAST): string {
		return new FlowchartRenderer(ast).toPlaintext();
	}
}
