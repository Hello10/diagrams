import type { Diagram } from "./Diagram.ts";
import type { Token } from "./types.ts";

/** What a span of source is. Editors map these to their own colors; the
 * library ships no colors and no editor code. */
export type HighlightKind =
	| "comment"
	| "directive"
	| "keyword"
	/** A declared name: a component, participant, state, node, or class. */
	| "type"
	| "string"
	/** Free text a diagram draws: a message, transition, or shape label. */
	| "label"
	| "operator"
	/** An attribute key, a flag, or a class member. */
	| "property"
	/** A value: an attribute value, a data path, or a call's arguments. */
	| "data"
	| "handle"
	| "mode"
	| "event"
	| "operation";

/** Part of one line. `line` and `col` are 1-indexed; `endCol` is exclusive. */
export type HighlightRange = {
	line: number;
	col: number;
	endCol: number;
	kind: HighlightKind;
};

/** A range, with UTF-16 offsets into the source for editors that use them. */
export type HighlightSpan = HighlightRange & { from: number; to: number };

export function highlightSpans(
	source: string,
	tokens: Token[],
	diagram: Diagram | undefined,
): HighlightSpan[] {
	const lines = source.split("\n");
	return flatten(lines, [
		...lexicalRanges(tokens, lines),
		...(diagram?.highlight?.(tokens, lines) ?? []),
	]);
}

/** Later ranges win where they overlap. The result is ordered, never overlaps,
 * and stays inside its lines whatever a classifier returned. */
function flatten(lines: string[], ranges: HighlightRange[]): HighlightSpan[] {
	const painted = new Map<number, (HighlightKind | undefined)[]>();
	for (const { line, col, endCol, kind } of ranges) {
		const text = lines[line - 1];
		if (text === undefined) continue;
		let row = painted.get(line);
		if (!row) {
			row = Array.from({ length: text.length }, () => undefined);
			painted.set(line, row);
		}
		for (let i = Math.max(col, 1) - 1; i < endCol - 1 && i < text.length; i++) {
			row[i] = kind;
		}
	}

	const spans: HighlightSpan[] = [];
	let offset = 0;
	for (const [index, text] of lines.entries()) {
		const line = index + 1;
		const row = painted.get(line);
		for (let i = 0; row && i < row.length;) {
			const kind = row[i];
			let end = i + 1;
			while (end < row.length && row[end] === kind) end++;
			if (kind) {
				spans.push({
					line,
					col: i + 1,
					endCol: end + 1,
					kind,
					from: offset + i,
					to: offset + end,
				});
			}
			i = end;
		}
		offset += text.length + 1;
	}
	return spans;
}

/** What every diagram shares, known from the token type alone. */
function lexicalRanges(tokens: Token[], lines: string[]): HighlightRange[] {
	const out: HighlightRange[] = [];
	for (const t of tokens) {
		switch (t.type) {
			case "comment":
				out.push(mark(t, "comment"));
				break;
			case "directive":
				out.push(mark(t, "directive"));
				break;
			case "string":
				out.push(mark(t, "string"));
				break;
			case "arrow":
				out.push(mark(t, "operator"));
				break;
			case "bracket":
				out.push(mark(t, "label"));
				break;
			case "labeled-arrow": {
				const bar = t.value.indexOf("|");
				const barCol = t.col + bar;
				out.push({ ...span(t.line, t.col, barCol), kind: "operator" });
				out.push({ ...span(t.line, barCol, t.endCol), kind: "label" });
				break;
			}
			case "attribute": {
				const eq = t.value.indexOf("=");
				const valueCol = t.col + eq + 1;
				const quoted = lines[t.line - 1]?.[valueCol - 1] === '"';
				out.push({ ...span(t.line, t.col, valueCol - 1), kind: "property" });
				out.push({
					...span(t.line, valueCol, t.endCol),
					kind: quoted ? "string" : "data",
				});
				break;
			}
			default:
		}
	}
	return out;
}

function span(line: number, col: number, endCol: number) {
	return { line, col, endCol };
}

// ─── For classifiers ─────────────────────────────────────────────────────────

/** A token as a range of one kind. */
export function mark(token: Token, kind: HighlightKind): HighlightRange {
	return { line: token.line, col: token.col, endCol: token.endCol, kind };
}

/** The tokens of each line that carries a statement, in order. */
export function statements(tokens: Token[]): Token[][] {
	const out: Token[][] = [];
	let current: Token[] = [];
	let line = -1;
	for (const t of tokens) {
		if (
			t.type === "newline" ||
			t.type === "indent" ||
			t.type === "dedent" ||
			t.type === "comment" ||
			t.type === "directive"
		)
			continue;
		if (t.line !== line) {
			if (current.length > 0) out.push(current);
			current = [];
			line = t.line;
		}
		current.push(t);
	}
	if (current.length > 0) out.push(current);
	return out;
}

/** From `col` to the end of the line, without the whitespace at either end. */
export function restOfLine(
	lines: string[],
	line: number,
	col: number,
	kind: HighlightKind,
): HighlightRange[] {
	const text = lines[line - 1] ?? "";
	let start = col - 1;
	while (start < text.length && /\s/.test(text[start] as string)) start++;
	const end = text.trimEnd().length;
	return start < end ? [{ line, col: start + 1, endCol: end + 1, kind }] : [];
}

export function isWord(token: Token | undefined, ...words: string[]): boolean {
	return token?.type === "identifier" && words.includes(token.value);
}

/** `title`, `accTitle`, and `accDescr` read the same in every diagram: a
 * keyword, then free text. Returns undefined for any other statement. */
export function metaLine(
	statement: Token[],
	lines: string[],
): HighlightRange[] | undefined {
	const first = statement[0];
	if (!first || !isWord(first, "title", "accTitle", "accDescr"))
		return undefined;
	const next = statement[1];
	const from = isWord(next, ":") ? next?.endCol : first.endCol;
	return [
		mark(first, "keyword"),
		...restOfLine(lines, first.line, from ?? first.endCol, "label"),
	];
}
