import {
	type HighlightRange,
	isWord,
	mark,
	metaLine,
	restOfLine,
	statements,
} from "../../highlight.ts";
import type { Token } from "../../types.ts";

export function flowchartHighlight(
	tokens: Token[],
	lines: string[],
): HighlightRange[] {
	const out: HighlightRange[] = [];
	for (const [index, statement] of statements(tokens).entries()) {
		const first = statement[0];
		if (!first) continue;
		const meta = metaLine(statement, lines);
		if (meta) {
			out.push(...meta);
			continue;
		}
		if (
			(index === 0 && isWord(first, "flowchart", "graph")) ||
			isWord(first, "direction")
		) {
			out.push(mark(first, "keyword"));
			if (statement[1]) out.push(mark(statement[1], "keyword"));
			continue;
		}
		if (isWord(first, "end")) {
			out.push(mark(first, "keyword"));
			continue;
		}
		if (isWord(first, "subgraph")) {
			out.push(mark(first, "keyword"));
			const id = statement[1];
			if (id?.type === "identifier" && statement.length <= 3) {
				out.push(mark(id, "type"));
			} else if (id?.type === "identifier") {
				out.push(...restOfLine(lines, first.line, first.endCol, "label"));
			}
			continue;
		}
		for (const t of statement) {
			if (t.type === "identifier" && t.value !== ":" && t.value !== "-") {
				out.push(mark(t, "type"));
			}
		}
	}
	return out;
}
