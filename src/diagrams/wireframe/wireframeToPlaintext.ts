import type {
	WireflowAST,
	WireflowEdge,
	WireframeAST,
	WireframeElementNode,
	WireframeOverride,
	WireframeUseImport,
} from "./wireframeTypes.ts";

// ─── Wireframe ───────────────────────────────────────────────────────────────

export function wireframeToPlaintext(ast: WireframeAST): string {
	const lines = ["wireframe"];
	if (ast.title) lines.push(`  title ${ast.title}`);
	if (ast.accTitle) lines.push(`  accTitle ${ast.accTitle}`);
	if (ast.accDescr) lines.push(`  accDescr ${ast.accDescr}`);
	if (ast.title || ast.accTitle || ast.accDescr) lines.push("");

	for (const use of ast.uses ?? []) {
		lines.push(`  ${renderUse(use)}`);
	}
	if ((ast.uses ?? []).length > 0) lines.push("");

	for (const viewport of ast.viewports ?? []) {
		lines.push(`  viewport ${viewport.name} width=${viewport.width}`);
	}
	if ((ast.viewports ?? []).length > 0) lines.push("");

	for (const def of Object.values(ast.defines ?? {})) {
		lines.push(`  define ${def.name}`);
		for (const templateId of def.template) {
			lines.push(...renderElement(templateId, ast.elements, "    "));
		}
		lines.push("  end");
		lines.push("");
	}

	const root = ast.elements[ast.root];
	for (const screenId of root?.children ?? []) {
		const screen = ast.elements[screenId];
		if (screen?.nodeKind !== "screen") continue;
		lines.push(`  screen ${screen.screenName ?? "Screen"}`);
		for (const childId of screen.children ?? []) {
			lines.push(...renderElement(childId, ast.elements, "    "));
		}
		for (const state of screen.states ?? []) {
			lines.push("");
			lines.push(`    state ${state.name}`);
			for (const override of state.overrides) {
				lines.push(`      ${renderOverride(override)}`);
			}
			for (const childId of state.children) {
				lines.push(...renderElement(childId, ast.elements, "      "));
			}
			lines.push("    end");
		}
		for (const block of screen.viewportOverrides ?? []) {
			lines.push("");
			lines.push(`    viewport ${block.viewport}`);
			for (const override of block.overrides) {
				lines.push(`      ${renderOverride(override)}`);
			}
			lines.push("    end");
		}
		lines.push("  end");
		lines.push("");
	}

	lines.push("end");
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function renderUse(use: WireframeUseImport): string {
	if (use.kind === "namespace") {
		return `use ${use.module} as ${use.alias}`;
	}
	return `use ${use.module} ${use.names.join(", ")}`;
}

/** True when a repeat/modal child was produced by the `repeat Card`
 * shorthand: a bare component reference with nothing else on it. */
function isBareReference(node: WireframeElementNode): boolean {
	return (
		node.nodeKind === "component" &&
		node.declaredId === undefined &&
		node.content === undefined &&
		node.data === undefined &&
		node.targetKind === undefined &&
		Object.keys(node.attributes).length === 0 &&
		node.flags.length === 0 &&
		(node.children?.length ?? 0) === 0
	);
}

function renderElement(
	id: string,
	elements: Record<string, WireframeElementNode>,
	indent: string,
): string[] {
	const node = elements[id];
	if (!node) return [];

	const head: string[] = [];
	let children = node.children ?? [];

	switch (node.nodeKind) {
		case "repeat":
		case "modal": {
			head.push(node.nodeKind);
			const only =
				children.length === 1 ? elements[children[0] ?? ""] : undefined;
			if (only && isBareReference(only)) {
				head.push(only.componentName ?? "MissingComponent");
				children = [];
			}
			break;
		}
		case "component":
			head.push(node.componentName ?? "MissingComponent");
			if (node.content !== undefined) head.push(renderContent(node.content));
			break;
		default:
			return [];
	}

	if (node.declaredId !== undefined)
		head.push(`id=${renderAttributeValue(node.declaredId)}`);
	if (node.data !== undefined)
		head.push(`data=${renderAttributeValue(node.data)}`);
	head.push(...renderAttributes(node.attributes));
	head.push(...node.flags);
	if (node.targetKind && node.target)
		head.push(`-->|${node.targetKind}|`, node.target);

	const lines = [`${indent}${head.join(" ")}`];
	if (children.length > 0) {
		for (const childId of children) {
			lines.push(...renderElement(childId, elements, `${indent}  `));
		}
		lines.push(`${indent}end`);
	}
	return lines;
}

function renderOverride(override: WireframeOverride): string {
	const parts = [override.id];
	if (override.content !== undefined)
		parts.push(renderContent(override.content));
	if (override.data !== undefined)
		parts.push(`data=${renderAttributeValue(override.data)}`);
	parts.push(...renderAttributes(override.attributes));
	parts.push(...override.flags);
	parts.push(...override.clearFlags.map((flag) => `-${flag}`));
	if (override.targetKind && override.target) {
		parts.push(`-->|${override.targetKind}|`, override.target);
	}
	return parts.join(" ");
}

function renderContent(content: string): string {
	return content.startsWith("$") ? content : `"${content}"`;
}

function renderAttributes(attributes: Record<string, string>): string[] {
	return Object.entries(attributes).map(
		([key, value]) => `${key}=${renderAttributeValue(value)}`,
	);
}

function renderAttributeValue(value: string): string {
	return /[\s"]/u.test(value) || value === "" ? `"${value}"` : value;
}

// ─── Wireflow ────────────────────────────────────────────────────────────────

export function wireflowToPlaintext(ast: WireflowAST): string {
	const lines = ["wireflow"];
	if (ast.title) lines.push(`  title ${ast.title}`);

	const touched = new Set<string>();
	for (const edge of ast.edges) {
		touched.add(edge.from);
		touched.add(edge.to);
	}

	// Declarations first: every decision, plus screens no edge mentions.
	const declarations: string[] = [];
	for (const id of ast.order) {
		const node = ast.nodes[id];
		if (!node) continue;
		if (node.kind === "decision") {
			declarations.push(`  decision ${node.id} "${node.question}"`);
		} else if (!touched.has(id)) {
			declarations.push(`  screen ${id}`);
		}
	}
	if (declarations.length > 0) {
		lines.push(...declarations);
		lines.push("");
	}

	for (const edge of ast.edges) {
		lines.push(`  ${renderEdge(edge)}`);
	}

	lines.push("end");
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function renderEdge(edge: WireflowEdge): string {
	let label = "";
	if (edge.branch !== undefined) {
		label = edge.branch;
	} else if (edge.interaction) {
		label = edge.trigger
			? `${edge.interaction} ${edge.trigger}`
			: edge.interaction;
	}
	const arrow = label ? `-->|${label}|` : "-->";
	return `${edge.from} ${arrow} ${edge.to}`;
}
