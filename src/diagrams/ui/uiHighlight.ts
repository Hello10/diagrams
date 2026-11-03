import {
	type HighlightRange,
	isWord,
	mark,
	metaLine,
	statements,
} from "../../highlight.ts";
import type { Token } from "../../types.ts";
import { KEYWORDS } from "./UiParser.ts";
import { UI_IO_MODES } from "./uiTypes.ts";

const PUNCTUATION = new Set(["{", "}", ";", ":", ","]);
const IO_MODES = new Set<string>(UI_IO_MODES);

export function uiHighlight(
	tokens: Token[],
	lines: string[],
): HighlightRange[] {
	const out: HighlightRange[] = [];
	for (const statement of statements(tokens)) {
		const first = statement[0];
		if (!first) continue;
		const meta = metaLine(statement, lines);
		if (meta) {
			out.push(...meta);
			continue;
		}
		for (const [i, t] of statement.entries()) {
			out.push(...classify(t, statement, i, first));
		}
	}
	return out;
}

function classify(
	t: Token,
	statement: Token[],
	i: number,
	first: Token,
): HighlightRange[] {
	switch (t.type) {
		case "hash":
			return [mark(t, "handle")];
		case "hook":
			return [mark(t, "mode")];
		case "tilde":
			return [mark(t, "operation")];
		case "bracket":
			return [mark(t, "data")];
		case "string":
			return interpolations(t);
		case "identifier":
			break;
		default:
			return [];
	}
	const word = t.value;
	if (PUNCTUATION.has(word)) return [];
	if (word.startsWith("$")) return [mark(t, "event")];
	if (isWord(first, "api") && i > 0) return [mark(t, "operation")];
	const prev = statement[i - 1];
	const next = statement[i + 1];
	// An outcome's mode: `ready => go Login`. Elsewhere those words are reserved.
	if (next?.type === "arrow" && IO_MODES.has(word)) return [mark(t, "mode")];
	if (KEYWORDS.has(word) || word === "go") return [mark(t, "keyword")];
	if (/^[A-Z]/.test(word)) return [mark(t, "type")];
	// A case's condition: `show.soldOut => …`.
	if (next?.type === "arrow") return [mark(t, "data")];
	if (isWord(prev, "when", "list", "as")) return [mark(t, "data")];
	// A lone lowercase word on a line is a flag: `primary`, `disabled`.
	return [mark(t, "property")];
}

/** A string, with each `{path}` in it marked as the data it is. */
function interpolations(t: Token): HighlightRange[] {
	const out: HighlightRange[] = [mark(t, "string")];
	for (const m of t.value.matchAll(/\{[^}]*\}/g)) {
		// The value starts one column in, past the opening quote.
		const col = t.col + 1 + m.index;
		out.push({
			line: t.line,
			col,
			endCol: col + m[0].length,
			kind: "data",
		});
	}
	return out;
}
