import {
	type HighlightRange,
	isWord,
	mark,
	metaLine,
	restOfLine,
	statements,
} from "../../highlight.ts";
import type { Token } from "../../types.ts";

export function stateHighlight(
	tokens: Token[],
	lines: string[],
): HighlightRange[] {
	const out: HighlightRange[] = [];
	let inNote = false;
	for (const [index, statement] of statements(tokens).entries()) {
		const first = statement[0];
		if (!first) continue;
		const last = statement[statement.length - 1] ?? first;
		if (inNote) {
			if (isWord(first, "end") && isWord(statement[1], "note")) {
				inNote = false;
				out.push({
					line: first.line,
					col: first.col,
					endCol: last.endCol,
					kind: "keyword",
				});
			} else {
				out.push(...restOfLine(lines, first.line, 1, "label"));
			}
			continue;
		}
		// `stateDiagram-v2` lexes as three tokens; it is one keyword.
		if (index === 0 && first.value.startsWith("state")) {
			out.push({
				line: first.line,
				col: first.col,
				endCol: last.endCol,
				kind: "keyword",
			});
			continue;
		}
		const meta = metaLine(statement, lines);
		if (meta) {
			out.push(...meta);
			continue;
		}
		if (isWord(first, "direction")) {
			out.push(mark(first, "keyword"));
			if (statement[1]) out.push(mark(statement[1], "keyword"));
			continue;
		}
		if (isWord(first, "note")) {
			const colon = statement.find((t) => isWord(t, ":"));
			for (const t of statement) {
				if (t === colon) break;
				if (t.type !== "identifier") continue;
				const word = isWord(t, "note", "left", "right", "of");
				out.push(mark(t, word ? "keyword" : "type"));
			}
			if (colon)
				out.push(...restOfLine(lines, colon.line, colon.endCol, "label"));
			else inNote = true;
			continue;
		}
		for (const t of statement) {
			if (isWord(t, ":")) {
				out.push(...restOfLine(lines, t.line, t.endCol, "label"));
				break;
			}
			if (t.type === "bracket" && t.value === "[*]") {
				out.push(mark(t, "keyword"));
			} else if (isWord(t, "state", "as")) {
				out.push(mark(t, "keyword"));
			} else if (
				t.type === "identifier" &&
				t.value !== "{" &&
				t.value !== "}"
			) {
				out.push(mark(t, "type"));
			}
		}
	}
	return out;
}
