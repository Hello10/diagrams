import type {
	DiagramAST,
	ParseError,
	ParseResult,
	Token,
	TokenType,
} from "./types.ts";

/**
 * Base class for all diagram parsers.
 * Subclasses implement a recursive descent parser over the token stream.
 */
export abstract class DiagramParser<AST extends DiagramAST> {
	protected tokens: Token[];
	protected pos: number;
	protected errors: ParseError[];

	constructor(tokens: Token[]) {
		this.tokens = tokens;
		this.pos = 0;
		this.errors = [];
	}

	abstract parse(): ParseResult<AST>;

	// ─── Token navigation ───────────────────────────────────────────────────

	/** Peek at the token at pos + offset without consuming. Returns undefined at EOF. */
	protected peek(offset = 0): Token | undefined {
		return this.tokens[this.pos + offset];
	}

	/** Consume and return the next token. Optionally assert type and/or value. */
	protected consume(type?: TokenType, value?: string): Token {
		const token = this.tokens[this.pos];
		if (!token) {
			const fakeToken: Token = {
				type: "newline",
				value: "",
				line: this.lastLine(),
				col: 0,
				indentLevel: 0,
			};
			this.error("Unexpected end of input", fakeToken);
			return fakeToken;
		}
		if (type !== undefined && token.type !== type) {
			this.error(
				`Expected token type '${type}' but got '${token.type}' ("${token.value}")`,
				token,
			);
		}
		if (value !== undefined && token.value !== value) {
			this.error(`Expected "${value}" but got "${token.value}"`, token);
		}
		this.pos++;
		return token;
	}

	/** Consume the next token only if it matches type (and optionally value). Returns it or undefined. */
	protected consumeIf(type: TokenType, value?: string): Token | undefined {
		const token = this.peek();
		if (!token) return undefined;
		if (token.type !== type) return undefined;
		if (value !== undefined && token.value !== value) return undefined;
		this.pos++;
		return token;
	}

	/** Skip newlines and comment tokens. */
	protected skipTrivia(): void {
		while (true) {
			const t = this.peek();
			if (!t) break;
			if (
				t.type === "newline" ||
				t.type === "comment" ||
				t.type === "indent" ||
				t.type === "dedent"
			) {
				this.pos++;
				continue;
			}
			break;
		}
	}

	/** Skip to end of current line (past the next newline token). */
	protected skipToEndOfLine(): void {
		while (true) {
			const t = this.peek();
			if (!t) break;
			this.pos++;
			if (t.type === "newline") break;
		}
	}

	/** True when all tokens have been consumed. */
	protected isAtEnd(): boolean {
		this.skipTrivia();
		return this.pos >= this.tokens.length;
	}

	// ─── Error handling ──────────────────────────────────────────────────────

	/** Record a parse error. Does not throw. */
	protected error(
		message: string,
		token?: Token,
		severity: "error" | "warning" = "error",
	): void {
		this.errors.push({
			message,
			line: token?.line ?? this.lastLine(),
			col: token?.col ?? 0,
			severity,
		});
	}

	/** Record a warning. */
	protected warn(message: string, token?: Token): void {
		this.error(message, token, "warning");
	}

	/** Build a ParseResult from accumulated errors and a (partial) AST. */
	protected result(ast: AST): ParseResult<AST> {
		const hardErrors = this.errors.filter((e) => e.severity === "error");
		if (hardErrors.length > 0) {
			return { ok: false, errors: this.errors, partialAst: ast };
		}
		return { ok: true, ast };
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private lastLine(): number {
		const last = this.tokens[this.tokens.length - 1];
		return last?.line ?? 1;
	}
}
