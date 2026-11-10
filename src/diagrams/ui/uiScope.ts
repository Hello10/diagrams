import type { UiAppAST, UiAST, UiComponent } from "./uiTypes.ts";

/**
 * Where a name lives when several documents are drawn together. A single
 * document is a scope of one; a set is every document of the app. Every
 * renderer resolves components, layouts, and navigation targets through
 * here, so a document alone and a document in its set read the same way.
 */

/** A declaration addressed across documents. `module` is undefined for
 * one of the document at hand. */
export type UiTarget = { module?: string; name: string };

export class UiScope {
	readonly ast: UiAST;
	readonly app?: UiAppAST;

	constructor({ ast, app }: { ast: UiAST; app?: UiAppAST }) {
		this.ast = ast;
		this.app = app;
	}

	/** The document a module string names, when it is in the set. */
	document(
		module: string | undefined,
		from: UiAST = this.ast,
	): UiAST | undefined {
		if (module === undefined || module === from.module) return from;
		return this.app?.documents[module];
	}

	/** A component by target, relative to `from`. Undefined when its
	 * document is out of reach. */
	component(target: UiTarget, from: UiAST = this.ast): UiComponent | undefined {
		return this.document(target.module, from)?.components[target.name];
	}

	/** A navigation or layout target as written in `from`: a local
	 * declaration, or what its import resolved to. */
	resolve(name: string, from: UiAST = this.ast): UiTarget {
		if (from.components[name]) return { name };
		const decl = from.imports[name];
		if (decl) return { module: decl.module, name: decl.name };
		return { name };
	}

	/** The documents in scope, the one at hand first when alone. */
	documents(): UiAST[] {
		if (!this.app) return [this.ast];
		return this.app.order.flatMap((m) => {
			const doc = this.app?.documents[m];
			return doc ? [doc] : [];
		});
	}
}

/** The id a flow node or frame gets: the name alone for a document drawn
 * by itself, qualified by its module in a set. */
export function targetId(target: UiTarget, from?: UiAST): string {
	const module = target.module ?? from?.module;
	return module === undefined ? target.name : `${module}::${target.name}`;
}

/** The label a stub carries for a declaration out of reach. */
export function targetLabel(target: UiTarget): string {
	return target.module === undefined
		? target.name
		: `${target.module} ${target.name}`;
}
