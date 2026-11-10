// ─── Token types ─────────────────────────────────────────────────────────────

export type TokenType =
	| "identifier" // Any bare word: PascalCase, camelCase, lowercase, $param
	| "hook" // @-prefixed identifier: @onSignIn — navigation/action hooks
	| "string" // "double-quoted values"
	| "attribute" // key=value pairs
	| "arrow" // -->
	| "labeled-arrow" // -->|"label"|
	| "bracket" // [...] — screen state labels: [loading], [loaded]
	| "hash" // #id — instance handle in the UI diagram
	| "tilde" // ~name — an io operation in the UI diagram
	| "indent" // Synthetic: emitted when indent level increases
	| "dedent" // Synthetic: emitted when indent level decreases
	| "newline" // Line boundary
	| "comment" // %% comment text
	| "directive"; // %%{...}%%

export type Token = {
	type: TokenType;
	/** Raw text value of the token. For 'bracket': includes brackets, e.g. "[loading]". */
	value: string;
	/** 1-indexed line number in the source. */
	line: number;
	/** 1-indexed column number of the token start. */
	col: number;
	/** 1-indexed column just past the token's source text. `value` can be
	 * shorter than that text: strings lose their quotes, comments their `%%`,
	 * handles and operations their sigil. */
	endCol: number;
	/** Indentation depth of the line this token is on (0-based). */
	indentLevel: number;
};

// ─── Parse result ─────────────────────────────────────────────────────────────

export type ParseError = {
	message: string;
	line: number;
	col: number;
	severity: "error" | "warning";
	/** The document the error is in, when several are parsed together. */
	module?: string;
};

export type ParseResult<T extends DiagramAST> =
	/** Warnings, when any, ride along with a successful parse. */
	| { ok: true; ast: T; warnings?: ParseError[] }
	| { ok: false; errors: ParseError[]; partialAst?: T };

// ─── Base AST types ───────────────────────────────────────────────────────────

/**
 * Base type for all parsed diagram documents.
 * `type` matches `Diagram.type` — the opening keyword that identified this grammar.
 */
export type DiagramAST = {
	type: string;
	title?: string;
	accTitle?: string;
	accDescr?: string;
};

/**
 * Base type for all element nodes within a diagram.
 * Diagram-type-specific fields are declared in subtypes — never added here.
 */
export type BaseElementNode = {
	id: string;
	type: string;
	/** Quoted string content of the element, if any. */
	content?: string;
	/** Open key=value attribute pairs. Values are unvalidated strings. */
	attributes: Record<string, string>;
	/** Bare word flags (e.g. bold, primary, disabled). */
	flags: string[];
	/** Child element IDs (for container elements). */
	children?: string[];
};

// The `Diagram<AST>` extension contract has moved to ./Diagram.ts as an
// abstract class. Import it from there.
