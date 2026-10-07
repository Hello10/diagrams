import type { DiagramParser } from "./DiagramParser.ts";
import { tokenize } from "./tokenizer.ts";
import type { DiagramAST, ParseResult, Token } from "./types.ts";

export interface ParserConstructor<
	AST extends DiagramAST,
	P extends DiagramParser<AST>,
> {
	new (tokens: Token[]): P;
}

interface ParserWithSource {
	setSource(lines: string[]): unknown;
}

function hasSetSource(parser: unknown): parser is ParserWithSource {
	return (
		typeof parser === "object" &&
		parser !== null &&
		"setSource" in parser &&
		typeof (parser as ParserWithSource).setSource === "function"
	);
}

/**
 * Creates a configured parse helper for a given Parser class.
 * Automatically runs the tokenizer, passes source lines, and unwraps the AST hook.
 */
export function createParseHelper<
	AST extends DiagramAST,
	P extends DiagramParser<AST>,
>(ParserClass: ParserConstructor<AST, P>) {
	return function parse(src: string): AST {
		const tokens = tokenize(src);
		const parser = new ParserClass(tokens);
		if (hasSetSource(parser)) {
			parser.setSource(src.split("\n"));
		}
		const result = parser.parse();
		if (!result.ok && result.partialAst) return result.partialAst;
		if (!result.ok) {
			throw new Error(
				`Parse failed: ${result.errors.map((e) => e.message).join("; ")}`,
			);
		}
		return result.ast;
	};
}

/**
 * Asserts that an API-level ParseResult is ok, throwing a formatted error if not,
 * and narrows/returns the parsed AST diagram.
 */
export function assertOk<T extends DiagramAST>(
	result: ParseResult<T> | ParseResult<DiagramAST>,
): T {
	if (!result.ok) {
		throw new Error(
			`Parse failed: ${result.errors.map((e) => e.message).join("; ")}`,
		);
	}
	// Also assert through expect when a test runner provides it, so the check counts as an assertion
	if (typeof expect !== "undefined") {
		expect(result.ok).toBe(true);
	}
	return result.ast as T;
}
