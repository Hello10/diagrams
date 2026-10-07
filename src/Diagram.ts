import type { DiagramAST, ParseResult, Token } from "./types.ts";

/**
 * Abstract base class for all diagram types.
 *
 * Each diagram subclass holds its registry metadata (`type`, `name`), a
 * `detect()` predicate that matches the opening line of its plaintext form,
 * and the three operations the package surfaces: `parse` (tokens → AST),
 * `render` (AST → SVG), and `toPlaintext` (AST → canonical source). The
 * subclass typically delegates parse to its `XParser` and render/toPlaintext
 * to its `XRenderer`.
 *
 * Register concrete subclasses with `registerDiagram(new XDiagram())`.
 */
export abstract class Diagram<AST extends DiagramAST = DiagramAST> {
	/** Registry key. Must match the opening keyword in plaintext
	 * (e.g. "wireframe", "wireflow", "sequenceDiagram", "flowchart"). */
	abstract readonly type: string;

	/** Human-readable label (e.g. "Wireframe", "Sequence Diagram"). */
	abstract readonly name: string;

	/** True if the given first non-trivial line indicates this diagram type. */
	abstract detect(firstLine: string): boolean;

	/**
	 * Parse a flat token stream into a typed AST. Never throws — all errors
	 * surface in the ParseResult.
	 * @param source Original source string, used by some parsers to
	 *   reconstruct label text faithfully.
	 */
	abstract parse(tokens: Token[], source?: string): ParseResult<AST>;

	/** Render the AST to an SVG string. */
	abstract render(ast: AST): string;

	/** Convert the AST back to canonical plaintext. Used for display, editing,
	 * and round-trip validation. */
	abstract toPlaintext(ast: AST): string;
}
