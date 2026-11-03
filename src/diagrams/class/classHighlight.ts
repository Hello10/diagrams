import {
	type HighlightRange,
	isWord,
	mark,
	metaLine,
	restOfLine,
	statements,
} from "../../highlight.ts";
import type { Token } from "../../types.ts";

export function classHighlight(
	tokens: Token[],
	lines: string[],
): HighlightRange[] {
	const out: HighlightRange[] = [];
	let inClassBody = false;
	for (const [index, statement] of statements(tokens).entries()) {
		const first = statement[0];
		if (!first) continue;
		const last = statement[statement.length - 1] ?? first;
		const text = (lines[first.line - 1] ?? "").trim();
		if (inClassBody) {
			if (isWord(first, "}")) {
				inClassBody = false;
			} else {
				const kind = text.startsWith("<<") ? "keyword" : "property";
				out.push(...restOfLine(lines, first.line, 1, kind));
			}
			continue;
		}
		const meta = metaLine(statement, lines);
		if (meta) {
			out.push(...meta);
			continue;
		}
		if (index === 0 && isWord(first, "classDiagram", "class")) {
			out.push(mark(first, "keyword"));
			continue;
		}
		if (isWord(first, "direction")) {
			out.push(mark(first, "keyword"));
			if (statement[1]) out.push(mark(statement[1], "keyword"));
			continue;
		}
		if (isWord(first, "namespace")) {
			out.push(mark(first, "keyword"));
			if (statement[1]) out.push(mark(statement[1], "type"));
			continue;
		}
		if (isWord(first, "class")) {
			out.push(mark(first, "keyword"));
			const name = statement[1];
			if (name) {
				// A generic reads as part of the name: `Repository~T~`.
				const source = lines[first.line - 1] ?? "";
				const match = /^[\w.$]+(~[^~\s]*~)?/.exec(source.slice(name.col - 1));
				out.push({
					line: name.line,
					col: name.col,
					endCol: name.col + (match?.[0].length ?? name.value.length),
					kind: "type",
				});
			}
			inClassBody = isWord(last, "{");
			continue;
		}
		if (isWord(first, "note")) {
			out.push(mark(first, "keyword"));
			const on = statement[1];
			if (isWord(on, "for")) {
				if (on) out.push(mark(on, "keyword"));
				if (statement[2]) out.push(mark(statement[2], "type"));
			}
			continue;
		}
		if (text.startsWith("<<")) {
			out.push(...restOfLine(lines, first.line, 1, "keyword"));
			continue;
		}
		// A relationship, or `Name : member` shorthand. What follows the colon
		// is a label on a relationship and a member on a name.
		const related = statement.some((t) => t.type === "arrow");
		for (const t of statement) {
			if (isWord(t, ":")) {
				const kind = related ? "label" : "property";
				out.push(...restOfLine(lines, t.line, t.endCol, kind));
				break;
			}
			if (t.type === "tilde") {
				out.push({
					line: t.line,
					col: t.col,
					endCol: t.endCol + 1,
					kind: "type",
				});
			} else if (t.type === "identifier" && t.value !== "}") {
				out.push(mark(t, "type"));
			}
		}
	}
	return out;
}
