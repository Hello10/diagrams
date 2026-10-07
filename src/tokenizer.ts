import type { Token, TokenType } from "./types.ts";

// Two-spaces or a tab count as one indent level.
const INDENT_WIDTH = 2;

type LexState = {
	source: string;
	lines: string[];
	tokens: Token[];
	currentIndent: number;
};

/**
 * Tokenize a plaintext diagram source string into a flat Token[].
 *
 * The tokenizer operates at the syntax level only — it recognises strings,
 * attributes, arrows, hooks, brackets, comments, and directives. Semantic
 * keyword classification is left to each diagram type's parser.
 */
export function tokenize(source: string): Token[] {
	const lines = source.split("\n");
	const state: LexState = {
		source,
		lines,
		tokens: [],
		currentIndent: 0,
	};

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const line = lines[lineIdx] ?? "";
		const lineNum = lineIdx + 1;
		lexLine(state, line, lineNum);
	}

	return state.tokens;
}

function lexLine(state: LexState, line: string, lineNum: number): void {
	// Measure indentation
	let col = 0;
	while (col < line.length && (line[col] === " " || line[col] === "\t")) {
		col++;
	}

	const raw = col < line.length ? line.slice(col) : "";

	// Blank line — skip entirely, no indent change
	if (raw === "") {
		return;
	}

	const indentChars = col;
	const indentLevel = Math.floor(indentChars / INDENT_WIDTH);

	// Emit synthetic indent/dedent tokens when level changes
	if (indentLevel > state.currentIndent) {
		for (let i = state.currentIndent; i < indentLevel; i++) {
			emit(state, "indent", "", lineNum, 1, i + 1);
		}
		state.currentIndent = indentLevel;
	} else if (indentLevel < state.currentIndent) {
		for (let i = state.currentIndent; i > indentLevel; i--) {
			emit(state, "dedent", "", lineNum, 1, i - 1);
		}
		state.currentIndent = indentLevel;
	}

	// Directive: %%{...}%%
	if (raw.startsWith("%%{") && raw.endsWith("}%%")) {
		emit(state, "directive", raw, lineNum, col + 1, indentLevel);
		emit(state, "newline", "", lineNum, line.length + 1, indentLevel);
		return;
	}

	// Comment: %% ...
	if (raw.startsWith("%%")) {
		emit(state, "comment", raw.slice(2).trim(), lineNum, col + 1, indentLevel);
		emit(state, "newline", "", lineNum, line.length + 1, indentLevel);
		return;
	}

	// Tokenize the content of the line
	lexContent(state, raw, lineNum, col, indentLevel);
	emit(state, "newline", "", lineNum, line.length + 1, indentLevel);
}

function lexContent(
	state: LexState,
	raw: string,
	lineNum: number,
	colOffset: number,
	indentLevel: number,
): void {
	let pos = 0;

	while (pos < raw.length) {
		// Skip spaces between tokens
		if (raw[pos] === " " || raw[pos] === "\t") {
			pos++;
			continue;
		}

		const col = colOffset + pos + 1; // 1-indexed

		// All arrow variants the parsers care about. Order matters: longer
		// prefixes must come first so the longest-match wins (e.g. `-->>` is
		// tried before `-->`). The tokenizer doesn't know which diagram it's
		// scanning — every parser gets the same `arrow` tokens and interprets
		// them in context. Grouped by the diagram type that originated each
		// entry so the table stays readable as more land.
		const ARROWS = [
			// Sequence + state: standard message / transition arrows.
			"-.->",
			"-->>",
			"-->",
			"->>",
			"->",
			"--x",
			"-x",
			"--)",
			"-)",
			// Flowchart: thick + dotted-line + plain-line variants.
			"==>",
			"-.-",
			"---",
			// Class diagram relationships (longer prefixes first; `--` and
			// `..` are last so the longer dashed-arrow forms win).
			"<|--",
			"--|>",
			"<|..",
			"..|>",
			"*--",
			"--*",
			"o--",
			"--o",
			"<..",
			"..>",
			"<--",
			"--",
			"..",
		] as const;
		let matchedArrow: string | undefined;
		for (const a of ARROWS) {
			if (raw.startsWith(a, pos)) {
				matchedArrow = a;
				break;
			}
		}
		if (matchedArrow) {
			const afterArrow = pos + matchedArrow.length;
			// Labeled arrow: arrow followed by |label|
			if (raw[afterArrow] === "|") {
				const closeBar = raw.indexOf("|", afterArrow + 1);
				if (closeBar !== -1) {
					emit(
						state,
						"labeled-arrow",
						raw.slice(pos, closeBar + 1),
						lineNum,
						col,
						indentLevel,
					);
					pos = closeBar + 1;
					continue;
				}
			}
			emit(state, "arrow", matchedArrow, lineNum, col, indentLevel);
			pos += matchedArrow.length;
			continue;
		}

		// String: "..."
		if (raw[pos] === '"') {
			const closeQuote = raw.indexOf('"', pos + 1);
			if (closeQuote !== -1) {
				emit(
					state,
					"string",
					raw.slice(pos + 1, closeQuote),
					lineNum,
					col,
					indentLevel,
				);
				pos = closeQuote + 1;
			} else {
				// Unclosed string — consume to end of line
				emit(state, "string", raw.slice(pos + 1), lineNum, col, indentLevel);
				pos = raw.length;
			}
			continue;
		}

		// Flowchart compound shape literals — checked before single-char
		// bracket / paren / brace handlers. The bracket token's value carries
		// the full literal (e.g. "([Incoming])") so the parser can decode
		// shape kind from the opener.
		const shape = matchShapeLiteral(raw, pos);
		if (shape) {
			emit(state, "bracket", shape.literal, lineNum, col, indentLevel);
			pos += shape.literal.length;
			continue;
		}

		// Bracket: [...]
		if (raw[pos] === "[") {
			const closeBracket = raw.indexOf("]", pos + 1);
			if (closeBracket !== -1) {
				emit(
					state,
					"bracket",
					raw.slice(pos, closeBracket + 1),
					lineNum,
					col,
					indentLevel,
				);
				pos = closeBracket + 1;
			} else {
				// Unclosed bracket — consume to end of line
				emit(state, "bracket", raw.slice(pos), lineNum, col, indentLevel);
				pos = raw.length;
			}
			continue;
		}

		// Brace shape literal: `{label}` only when immediately adjacent to the
		// previous identifier (no space gap, prior char is identifier-like).
		// A space-separated `{` is treated as a block opener and falls through
		// to the punctuation branch — this preserves `state Foo {` block syntax.
		// `@{...}` is reserved for the Mermaid v11 flowchart shape decorator
		// and is handled by interior token parsing, not as a shape literal.
		if (raw[pos] === "{" && pos > 0 && isIdentChar(raw[pos - 1] ?? "")) {
			// Double-brace `{{...}}` is already handled by matchShapeLiteral;
			// here we capture single-brace `{...}` diamond shapes.
			const closeBrace = raw.indexOf("}", pos + 1);
			if (closeBrace !== -1) {
				emit(
					state,
					"bracket",
					raw.slice(pos, closeBrace + 1),
					lineNum,
					col,
					indentLevel,
				);
				pos = closeBrace + 1;
				continue;
			}
		}

		// Round shape `(label)` — only when directly attached to a preceding
		// identifier character. The double-paren `((...))` circle shape is
		// already caught by matchShapeLiteral above.
		if (raw[pos] === "(" && pos > 0 && isIdentChar(raw[pos - 1] ?? "")) {
			const closeParen = raw.indexOf(")", pos + 1);
			if (closeParen !== -1) {
				emit(
					state,
					"bracket",
					raw.slice(pos, closeParen + 1),
					lineNum,
					col,
					indentLevel,
				);
				pos = closeParen + 1;
				continue;
			}
		}

		// Hook: @identifier, or module path-like identifier: @scope/pkg.
		// `@` must be followed by an identifier-start char; sequences like
		// `@{shape: rect}` (flowchart shape decorator) fall through.
		if (raw[pos] === "@" && isIdentStart(raw[pos + 1] ?? "")) {
			const start = pos;
			pos++; // skip @
			while (
				pos < raw.length &&
				raw[pos] !== " " &&
				raw[pos] !== "\t" &&
				raw[pos] !== "," &&
				raw[pos] !== ")"
			) {
				pos++;
			}
			const rawValue = raw.slice(start, pos);
			if (rawValue.includes("/")) {
				emit(state, "identifier", rawValue, lineNum, col, indentLevel);
			} else {
				emit(state, "hook", rawValue, lineNum, col, indentLevel);
			}
			continue;
		}

		// Identifier or attribute (key=value)
		if (isIdentStart(raw[pos] as string)) {
			const start = pos;
			while (pos < raw.length && isIdentChar(raw[pos] as string)) {
				pos++;
			}
			const word = raw.slice(start, pos);

			// Check for attribute: key=value
			if (raw[pos] === "=") {
				pos++; // skip '='
				let value: string;
				if (raw[pos] === '"') {
					const closeQuote = raw.indexOf('"', pos + 1);
					if (closeQuote !== -1) {
						value = raw.slice(pos + 1, closeQuote);
						pos = closeQuote + 1;
					} else {
						value = raw.slice(pos + 1);
						pos = raw.length;
					}
				} else {
					const valueStart = pos;
					while (pos < raw.length && raw[pos] !== " " && raw[pos] !== "\t") {
						pos++;
					}
					value = raw.slice(valueStart, pos);
				}
				emit(state, "attribute", `${word}=${value}`, lineNum, col, indentLevel);
			} else {
				emit(state, "identifier", word, lineNum, col, indentLevel);
			}
			continue;
		}

		// Numeric run — emit as identifier so that column positions for
		// `consumeRestOfLine`-style slicing stay accurate (otherwise labels
		// like `200 OK + token` lose their leading number when the parser
		// reads from the first surviving token's column).
		if (raw[pos] !== undefined && /[0-9]/.test(raw[pos] as string)) {
			const start = pos;
			while (pos < raw.length && /[0-9]/.test(raw[pos] as string)) {
				pos++;
			}
			emit(
				state,
				"identifier",
				raw.slice(start, pos),
				lineNum,
				col,
				indentLevel,
			);
			continue;
		}

		// Punctuation tokens — used as structural elements
		if (
			raw[pos] === ":" ||
			raw[pos] === "{" ||
			raw[pos] === "}" ||
			raw[pos] === "-"
		) {
			const punctuation = raw[pos];
			if (punctuation) {
				emit(
					state,
					"identifier",
					punctuation,
					lineNum,
					colOffset + pos + 1,
					indentLevel,
				);
			}
			pos++;
			continue;
		}

		// Unknown character — skip it
		pos++;
	}
}

function emit(
	state: LexState,
	type: TokenType,
	value: string,
	line: number,
	col: number,
	indentLevel: number,
): void {
	state.tokens.push({ type, value, line, col, indentLevel });
}

function isIdentStart(ch: string): boolean {
	return /[a-zA-Z_$]/.test(ch);
}

function isIdentChar(ch: string): boolean {
	return /[a-zA-Z0-9_$.]/.test(ch);
}

/** Compound shape openers used by flowchart node syntax. The tokenizer emits
 * a single `bracket` token for the full literal and the flowchart parser
 * decodes which shape kind from the opener / closer pair. Order matters:
 * longer or more-specific openers must come before shorter ones (e.g. `(((`
 * before `((`). Each entry lists every acceptable closer — `[/` accepts both
 * `/]` for parallelogram and `\]` for trapezoid because the closer
 * disambiguates between them. Returns the full literal text for the bracket
 * token, or null if no shape matches at this position. */
const SHAPE_OPENERS: { open: string; closes: string[] }[] = [
	// Rectangular family: subroutine, cylinder, parallelogram, trapezoid.
	{ open: "[[", closes: ["]]"] },
	{ open: "[(", closes: [")]"] },
	{ open: "[/", closes: ["/]", "\\]"] },
	{ open: "[\\", closes: ["\\]", "/]"] },
	// Stadium (pill).
	{ open: "([", closes: ["])"] },
	// Round / circle / double-circle. Triple-paren must come before "((" so
	// the longest match wins.
	{ open: "(((", closes: [")))"] },
	{ open: "((", closes: ["))"] },
	// Hexagon.
	{ open: "{{", closes: ["}}"] },
	// Asymmetric flag shape: `>text]` — only meaningful when adjacent to the
	// preceding identifier, which is enforced by the bracket-emit path before
	// this generic matcher.
	{ open: ">", closes: ["]"] },
];

function matchShapeLiteral(
	raw: string,
	pos: number,
): { literal: string } | null {
	for (const { open, closes } of SHAPE_OPENERS) {
		if (!raw.startsWith(open, pos)) continue;
		let closeIdx = -1;
		let closeLen = 0;
		for (const close of closes) {
			const idx = raw.indexOf(close, pos + open.length);
			if (idx !== -1 && (closeIdx === -1 || idx < closeIdx)) {
				closeIdx = idx;
				closeLen = close.length;
			}
		}
		if (closeIdx !== -1) {
			return { literal: raw.slice(pos, closeIdx + closeLen) };
		}
	}
	return null;
}
