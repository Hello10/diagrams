import { Diagram } from "../../Diagram.ts";
import type { ParseResult, Token } from "../../types.ts";
import { StateParser } from "./StateParser.ts";
import { StateRenderer } from "./StateRenderer.ts";
import type { StateDiagramAST } from "./stateTypes.ts";

export class StateDiagram extends Diagram<StateDiagramAST> {
	readonly type = "stateDiagram";
	readonly name = "State Diagram";

	detect(firstLine: string): boolean {
		const l = firstLine.trim().toLowerCase();
		return l === "statediagram-v2" || l === "statediagram" || l === "state";
	}

	parse(tokens: Token[], source?: string): ParseResult<StateDiagramAST> {
		const parser = new StateParser(tokens);
		if (source) parser.setSource(source.split("\n"));
		return parser.parse();
	}

	render(ast: StateDiagramAST): string {
		return new StateRenderer(ast).render();
	}

	toPlaintext(ast: StateDiagramAST): string {
		return new StateRenderer(ast).toPlaintext();
	}
}
