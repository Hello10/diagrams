import { tokenize } from "../../tokenizer.ts";
import type { ParseError, ParseResult } from "../../types.ts";
import { UiParser } from "./UiParser.ts";
import type { UiAppAST, UiAST } from "./uiTypes.ts";

/**
 * A set of `ui` documents parsed together. Every document is read before
 * any is checked, so documents may import each other in cycles and
 * declaration order across them is free. `resolve` supplies documents the
 * set refers to but does not render; their declarations are checked
 * against, and their screens draw as stubs.
 */
export function parseUiApp({
	documents,
	resolve,
}: {
	/** Module string → source. The keys are what the documents' `use`
	 * lines name each other by. */
	documents: Record<string, string>;
	resolve?: (module: string) => string | undefined;
}): ParseResult<UiAppAST> {
	const order = Object.keys(documents);
	const errors: ParseError[] = [];
	const parsed = new Map<string, { parser: UiParser; ast: UiAST }>();

	const read = (module: string, source: string) => {
		const parser = new UiParser(tokenize(source));
		const ast = parser.parseDocument();
		ast.module = module;
		parsed.set(module, { parser, ast });
		return ast;
	};
	for (const module of order) {
		const source = documents[module] ?? "";
		if (!isUiDocument(source)) {
			errors.push({
				message: `"${module}" is not a ui document; its first line is "${firstLine(source) ?? ""}"`,
				line: 1,
				col: 1,
				severity: "error",
				module,
			});
			continue;
		}
		read(module, source);
	}

	// Documents the set names but does not hold, read once each. Nothing
	// of theirs is checked beyond what an importer asks for, and nothing
	// they import is followed.
	const outside = new Map<string, UiAST | undefined>();
	const lookup = (module: string): UiAST | undefined => {
		const inSet = parsed.get(module);
		if (inSet) return inSet.ast;
		if (outside.has(module)) return outside.get(module);
		const source = resolve?.(module);
		const ast =
			source === undefined
				? undefined
				: (() => {
						const parser = new UiParser(tokenize(source));
						const doc = parser.parseDocument();
						doc.module = module;
						return doc;
					})();
		outside.set(module, ast);
		return ast;
	};

	for (const module of order) {
		const entry = parsed.get(module);
		if (!entry) continue;
		entry.parser.check(entry.ast, lookup);
		for (const e of entry.parser.collect()) errors.push({ ...e, module });
	}

	const app: UiAppAST = {
		type: "ui-app",
		documents: Object.fromEntries(
			order.flatMap((m) => {
				const entry = parsed.get(m);
				return entry ? [[m, entry.ast]] : [];
			}),
		),
		order,
	};

	// Where the app opens: exactly one screen at `/` across the set.
	const entries = order.flatMap((module) => {
		const ast = app.documents[module];
		if (!ast?.entry) return [];
		return [{ module, screen: ast.entry }];
	});
	const first = entries[0];
	if (entries.length === 1 && first) {
		app.entry = first;
	} else if (entries.length === 0 && order.length > 0) {
		errors.push({
			message:
				"No screen has route=/ in any document; that is where the app opens",
			line: 1,
			col: 1,
			severity: "error",
			module: order[0],
		});
	} else if (entries.length > 1) {
		const list = entries.map((e) => `${e.module} ${e.screen}`).join(", ");
		for (const e of entries) {
			errors.push({
				message: `More than one screen has route=/ (${list}); the app opens at one`,
				line: 1,
				col: 1,
				severity: "error",
				module: e.module,
			});
		}
	}

	if (errors.some((e) => e.severity === "error"))
		return { ok: false, errors, partialAst: app };
	if (errors.length > 0) return { ok: true, ast: app, warnings: errors };
	return { ok: true, ast: app };
}

/** The first line that is not blank, a comment, or a frontmatter rule. */
function firstLine(source: string): string | undefined {
	for (const line of source.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("%%") || trimmed.startsWith("---"))
			continue;
		return trimmed;
	}
	return undefined;
}

function isUiDocument(source: string): boolean {
	const first = firstLine(source);
	return first !== undefined && /^ui\b/i.test(first);
}
