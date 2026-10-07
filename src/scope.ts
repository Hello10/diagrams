/**
 * Shared scope-handling utilities for diagrams that support nested containers
 * (flowchart subgraphs, class diagram namespaces, etc.).
 *
 * The contract: any "container" type provides an `id` and a list of
 * `children` ids. From that we derive a containment map (child → enclosing
 * scope), ancestor chains, LCA computation, and edge-partitioning by scope —
 * enough that each renderer's per-diagram code can focus on the geometry of
 * the boxes inside each scope, not the bookkeeping around scopes.
 */

/** Synthetic id for the implicit outermost scope. Anything not declared
 * inside a named container belongs to ROOT_SCOPE. */
export const ROOT_SCOPE = "__root__";

/** Build `Map<childId, parentScopeId>` covering every contained id. Ids not
 * present in the map are implicitly in `ROOT_SCOPE`. */
export function buildContainmentMap(
	scopes: ReadonlyArray<{ id: string; children: ReadonlyArray<string> }>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const s of scopes) {
		for (const c of s.children) map.set(c, s.id);
	}
	return map;
}

/** Walk a node's ancestor chain up to the root scope, e.g.
 * `Resolve → Validate → __root__`. The last element is always
 * `ROOT_SCOPE`. */
export function ancestorChain(
	id: string,
	containing: Map<string, string>,
): string[] {
	const chain = [id];
	let cur = containing.get(id) ?? ROOT_SCOPE;
	for (let safety = 0; safety < 64; safety++) {
		chain.push(cur);
		if (cur === ROOT_SCOPE) break;
		cur = containing.get(cur) ?? ROOT_SCOPE;
	}
	return chain;
}

/** LCA + per-side immediate-child ancestor for a `from → to` edge. For
 * `Resolve (in Validate) → Cache (in root)`, the LCA is root and the
 * phantom participants are `Validate → Cache`. Returns `null` only if one
 * of the endpoints has no path to the root (shouldn't happen for
 * well-formed input). */
export function computeLcaPhantom(
	from: string,
	to: string,
	containing: Map<string, string>,
): { scope: string; fromInLca: string; toInLca: string } | null {
	const fromChain = ancestorChain(from, containing);
	const toChain = ancestorChain(to, containing);
	const toSet = new Set(toChain);
	for (let i = 0; i < fromChain.length; i++) {
		const a = fromChain[i];
		if (a === undefined || !toSet.has(a)) continue;
		const fromInLca = i === 0 ? from : (fromChain[i - 1] as string);
		const toIdx = toChain.indexOf(a);
		const toInLca = toIdx === 0 ? to : (toChain[toIdx - 1] as string);
		return { scope: a, fromInLca, toInLca };
	}
	return null;
}

/** A phantom projection of a cross-scope edge into its LCA scope. The
 * original edge is preserved so phantoms can be deduped against their
 * real cross-scope render path. */
export interface ScopePhantom<E> {
	from: string;
	to: string;
	original: E;
}

/** Group edges by the scope they live in.
 *
 *   - Same-scope edges (both endpoints inside `s`) go in `byScope[s]`.
 *   - Cross-scope edges land in `crossScope` AND get a phantom projection
 *     at their LCA scope under `phantomsByScope[lca]`, so each scope's
 *     ranking pass treats the cross-scope partner as if it were a
 *     same-scope neighbour.
 *
 * `endpointOf` extracts the `from`/`to` ids from a domain-specific edge
 * shape (FlowEdge, ClassRelationship, …). */
export function partitionEdgesByScope<E>(
	edges: ReadonlyArray<E>,
	containing: Map<string, string>,
	endpointOf: (edge: E) => { from: string; to: string },
): {
	byScope: Map<string, E[]>;
	crossScope: E[];
	phantomsByScope: Map<string, Array<ScopePhantom<E>>>;
} {
	const byScope = new Map<string, E[]>();
	const crossScope: E[] = [];
	const phantomsByScope = new Map<string, Array<ScopePhantom<E>>>();
	for (const e of edges) {
		const { from, to } = endpointOf(e);
		const fromScope = containing.get(from) ?? ROOT_SCOPE;
		const toScope = containing.get(to) ?? ROOT_SCOPE;
		if (fromScope === toScope) {
			const list = byScope.get(fromScope) ?? [];
			list.push(e);
			byScope.set(fromScope, list);
			continue;
		}
		crossScope.push(e);
		const lca = computeLcaPhantom(from, to, containing);
		if (lca) {
			const list = phantomsByScope.get(lca.scope) ?? [];
			list.push({ from: lca.fromInLca, to: lca.toInLca, original: e });
			phantomsByScope.set(lca.scope, list);
		}
	}
	return { byScope, crossScope, phantomsByScope };
}
