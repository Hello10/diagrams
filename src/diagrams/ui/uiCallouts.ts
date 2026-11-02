import { parseCall } from "./UiParser.ts";
import {
	renderArgs,
	type UiComponent,
	type UiHandler,
	type UiNode,
} from "./uiTypes.ts";

/**
 * Walking a component's tree at the AST level: every node including those
 * under `when` cases, the mode each sits in, and the navigation a
 * component declares. The flow renderer and the statechart use these; the
 * storyboard's callouts come from the built frame instead (see
 * `frameCallouts`).
 */

/** Visit every node of a tree with the authored mode it sits in: the mode
 * of the nearest enclosing `when @mode` case, or undefined. */
export function walkTree(
	nodes: UiNode[],
	visit: (node: UiNode, mode: string | undefined) => void,
	mode?: string,
): void {
	for (const node of nodes) {
		visit(node, mode);
		if (node.kind === "when") {
			for (const kase of node.cases ?? []) {
				walkTree(
					kase.nodes,
					visit,
					kase.condition.kind === "mode" ? kase.condition.mode : mode,
				);
			}
			continue;
		}
		walkTree(node.children, visit, mode);
	}
}

export function allNodes(component: UiComponent): UiNode[] {
	const out: UiNode[] = [];
	walkTree(component.tree, (n) => {
		out.push(n);
	});
	return out;
}

/** Every handler a component declares, with where it is written: the node
 * it is on (or the node an override addresses) and the mode it sits in. */
export function allHandlers(
	component: UiComponent,
): { handler: UiHandler; node?: UiNode; mode?: string }[] {
	const out: { handler: UiHandler; node?: UiNode; mode?: string }[] = [];
	walkTree(component.tree, (node, mode) => {
		for (const handler of node.handlers) out.push({ handler, node, mode });
	});
	const byHandle = new Map<string, UiNode>();
	for (const n of allNodes(component)) if (n.id) byHandle.set(n.id, n);
	for (const when of component.whens) {
		for (const kase of when.cases ?? []) {
			const mode =
				kase.condition.kind === "mode" ? kase.condition.mode : undefined;
			for (const o of kase.overrides) {
				const node = byHandle.get(o.handle);
				for (const handler of o.handlers) out.push({ handler, node, mode });
			}
		}
	}
	return out;
}

/** What fires `event` on `node`, in the words of the component that wrote
 * the handler: `click View`, `change Search bands` on an element; `open
 * BandResult`, `select TrackRow` on a component instance. The instance's
 * own section explains what a person does inside it. */
export function handlerLabel(node: UiNode | undefined, event: string): string {
	if (!node) return event;
	if (node.ref?.kind === "component") return `${event} ${node.ref.name}`;
	return `${event} ${nodeName(node)}`.trim();
}

/** The name a person would use for an element: its text, its placeholder,
 * or its type. */
export function nodeName(node: UiNode): string {
	return (
		node.content ??
		node.attributes.placeholder ??
		node.attributes.label ??
		node.name ??
		node.kind
	);
}

/** A move to a screen declared somewhere in a component: a `go` action on
 * a handler or an io outcome, or a link's `to=`. */
export type Navigation = {
	screen: string;
	args: Record<string, string>;
	/** How the flow labels the edge: `click View`, `~signIn.ready`. */
	label: string;
};

export function navigations(component: UiComponent): Navigation[] {
	const out: Navigation[] = [];
	for (const { handler, node } of allHandlers(component)) {
		if (handler.action.kind !== "go") continue;
		out.push({
			screen: handler.action.screen,
			args: handler.action.args,
			label: handlerLabel(node, handler.event),
		});
	}
	for (const io of component.io) {
		for (const outcome of io.outcomes) {
			if (outcome.action.kind !== "go") continue;
			out.push({
				screen: outcome.action.screen,
				args: outcome.action.args,
				label: `~${io.name}.${outcome.mode}`,
			});
		}
	}
	for (const node of allNodes(component)) {
		const to = node.attributes.to;
		if (to === undefined) continue;
		const call = parseCall(to);
		if (!call) continue;
		out.push({
			screen: call.name,
			args: {},
			label: `click ${nodeName(node)}`,
		});
	}
	return out;
}

export function renderNavigation(n: Navigation): string {
	return `go ${n.screen}${renderArgs(n.args)}`;
}
