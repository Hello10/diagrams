import {
	type HighlightRange,
	isWord,
	mark,
	metaLine,
	restOfLine,
	statements,
} from "../../highlight.ts";
import type { Token } from "../../types.ts";

const LABELED_BLOCKS = [
	"loop",
	"alt",
	"else",
	"opt",
	"par",
	"and",
	"critical",
	"option",
	"break",
];

export function sequenceHighlight(
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
		if (index === 0 && isWord(first, "sequenceDiagram", "sequence")) {
			out.push(mark(first, "keyword"));
			continue;
		}
		if (isWord(first, "participant", "actor")) {
			out.push(mark(first, "keyword"));
			const name = statement[1];
			const as = statement[2];
			if (name?.type === "identifier") out.push(mark(name, "type"));
			if (as && isWord(as, "as")) {
				out.push(mark(as, "keyword"));
				out.push(...restOfLine(lines, as.line, as.endCol, "label"));
			}
			continue;
		}
		if (isWord(first, "activate", "deactivate")) {
			out.push(mark(first, "keyword"));
			if (statement[1]) out.push(mark(statement[1], "type"));
			continue;
		}
		if (isWord(first, ...LABELED_BLOCKS)) {
			out.push(mark(first, "keyword"));
			out.push(...restOfLine(lines, first.line, first.endCol, "label"));
			continue;
		}
		if (isWord(first, "rect")) {
			out.push(mark(first, "keyword"));
			out.push(...restOfLine(lines, first.line, first.endCol, "data"));
			continue;
		}
		if (isWord(first, "end", "autonumber")) {
			out.push(mark(first, "keyword"));
			continue;
		}
		// A note or a message: names, then free text after the colon.
		for (const t of statement) {
			if (isWord(t, ":")) {
				out.push(...restOfLine(lines, t.line, t.endCol, "label"));
				break;
			}
			if (t.type !== "identifier" || t.value === "-") continue;
			const word =
				t === first
					? isWord(t, "note")
					: isWord(first, "note") && isWord(t, "over", "left", "right", "of");
			out.push(mark(t, word ? "keyword" : "type"));
		}
	}
	return out;
}
