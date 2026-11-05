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

/** An open `when`, by the indent of its line: its cases sit one level in. */
type Open = { indent: number; on: "mode" | "io" | "data" };

export function uiHighlight(
	tokens: Token[],
	lines: string[],
): HighlightRange[] {
	const out: HighlightRange[] = [];
	const open: Open[] = [];
	for (const statement of statements(tokens)) {
		const first = statement[0];
		if (!first) continue;
		while (
			open.length > 0 &&
			(open[open.length - 1] as Open).indent >= first.indentLevel
		)
			open.pop();
		const meta = metaLine(statement, lines);
		if (meta) {
			out.push(...meta);
			continue;
		}
		// A case label: the line under a when that is a label alone or
		// `label {`. Its kind is the subject's.
		const top = open[open.length - 1];
		const label =
			top && first.indentLevel === top.indent + 1 && isLabel(statement)
				? first
				: undefined;
		for (const [i, t] of statement.entries()) {
			if (t === label && !isWord(t, "else")) {
				out.push(mark(t, top?.on === "data" ? labelKind(t) : "mode"));
				continue;
			}
			out.push(...classify(t, statement, i, first));
		}
		if (isWord(first, "when")) {
			const subject = statement[1];
			const on =
				subject?.type === "tilde"
					? "io"
					: isWord(subject, "@")
						? "mode"
						: "data";
			open.push({ indent: first.indentLevel, on });
		}
	}
	return out;
}

function isLabel(statement: Token[]): boolean {
	const [first, second] = statement;
	if (!first || (first.type !== "identifier" && first.type !== "string"))
		return false;
	if (first.type === "identifier" && PUNCTUATION.has(first.value)) return false;
	return second === undefined || isWord(second, "{");
}

function labelKind(t: Token): "type" | "data" | "string" {
	if (t.type === "string") return "string";
	return /^[A-Z]/.test(t.value) ? "type" : "data";
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
	if (word === "@") return [mark(t, "mode")];
	if (word.startsWith("$")) return [mark(t, "event")];
	if (isWord(first, "api") && i > 0) return [mark(t, "operation")];
	const prev = statement[i - 1];
	const next = statement[i + 1];
	// An outcome's mode: `ready => go Login`. Elsewhere those words are reserved.
	if (next?.type === "arrow" && IO_MODES.has(word)) return [mark(t, "mode")];
	if (KEYWORDS.has(word) || word === "go") return [mark(t, "keyword")];
	if (/^[A-Z]/.test(word)) return [mark(t, "type")];
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
