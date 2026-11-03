// Explicit registration of built-in diagram types.
import { ClassDiagram } from "./diagrams/class/index.ts";
import { FlowchartDiagram } from "./diagrams/flowchart/index.ts";
import { SequenceDiagram } from "./diagrams/sequence/index.ts";
import { StateDiagram } from "./diagrams/state/index.ts";
import { UiDiagram } from "./diagrams/ui/index.ts";
import { type HighlightSpan, highlightSpans } from "./highlight.ts";
import { detectDiagram, getDiagram, registerDiagram } from "./registry.ts";
import { tokenize } from "./tokenizer.ts";
import type { DiagramAST, ParseResult } from "./types.ts";

registerDiagram(new FlowchartDiagram());
registerDiagram(new SequenceDiagram());
registerDiagram(new StateDiagram());
registerDiagram(new ClassDiagram());
registerDiagram(new UiDiagram());

/**
 * Parse a plaintext diagram source string into a JSON AST.
 *
 * The first non-trivial line is used to detect the diagram type.
 * Returns a ParseResult — never throws.
 */
export function parse<AST extends DiagramAST = DiagramAST>(
	source: string,
): ParseResult<AST> {
	const firstLine = getFirstMeaningfulLine(source);
	if (!firstLine) {
		return {
			ok: false,
			errors: [
				{ message: "Empty diagram source", line: 1, col: 1, severity: "error" },
			],
		};
	}

	const diagram = detectDiagram(firstLine);
	if (!diagram) {
		return {
			ok: false,
			errors: [
				{
					message: `Unknown diagram type. First line: "${firstLine}"`,
					line: 1,
					col: 1,
					severity: "error",
				},
			],
		};
	}

	const tokens = tokenize(source);
	return diagram.parse(tokens, source) as ParseResult<AST>;
}

/**
 * Classify a source string for syntax highlighting: spans of source text with
 * a kind, in order and never overlapping. Editor-neutral, and works on
 * half-typed source, since it needs tokens rather than a successful parse.
 * Never throws. A source of no known type gets the lexical layer alone.
 */
export function highlight(source: string): HighlightSpan[] {
	const firstLine = getFirstMeaningfulLine(source);
	const diagram = firstLine ? detectDiagram(firstLine) : undefined;
	return highlightSpans(source, tokenize(source), diagram);
}

/**
 * Render a parsed diagram AST to an SVG string.
 */
export function render(ast: DiagramAST): string {
	const diagram = getDiagram(ast.type);
	if (!diagram) {
		throw new Error(
			`No renderer registered for diagram type "${ast.type}". ` +
				`Ensure the diagram type is registered with registerDiagram() before rendering.`,
		);
	}
	return diagram.render(ast);
}

/**
 * Convert a parsed diagram AST to a JSON string.
 */
export function toJSON(ast: DiagramAST): string {
	return JSON.stringify(ast, null, 2);
}

/**
 * Parse a JSON string back into a DiagramAST.
 * The returned object is typed as DiagramAST; cast to the specific type if needed.
 */
export function fromJSON(json: string): DiagramAST {
	return JSON.parse(json) as DiagramAST;
}

/**
 * Convert a parsed diagram AST back to canonical plaintext.
 */
export function toPlaintext(ast: DiagramAST): string {
	const diagram = getDiagram(ast.type);
	if (!diagram) {
		throw new Error(
			`No toPlaintext implementation registered for diagram type "${ast.type}".`,
		);
	}
	return diagram.toPlaintext(ast);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getFirstMeaningfulLine(source: string): string | undefined {
	for (const line of source.split("\n")) {
		const trimmed = line.trim();
		if (
			trimmed === "" ||
			trimmed.startsWith("%%") ||
			trimmed.startsWith("---")
		) {
			continue;
		}
		return trimmed;
	}
	return undefined;
}
