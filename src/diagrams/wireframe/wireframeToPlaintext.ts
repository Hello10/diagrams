import type {
	WireflowAST,
	WireframeAST,
	WireframeElementNode,
	WireframeUseImport,
} from "./wireframeTypes.ts";

export function wireframeToPlaintext(ast: WireframeAST): string {
	const lines = ["wireframe"];

	for (const use of ast.uses || []) {
		lines.push(`  ${renderUse(use)}`);
	}
	if ((ast.uses || []).length > 0) {
		lines.push("");
	}

	for (const def of Object.values(ast.defines || {})) {
		lines.push(`  define ${def.name}`);
		for (const templateId of def.template) {
			lines.push(...renderElement(templateId, ast.elements, "    "));
		}
		lines.push("  end");
		lines.push("");
	}

	const rootNode = ast.elements[ast.root];
	if (rootNode?.children) {
		for (const childId of rootNode.children) {
			lines.push(...renderElement(childId, ast.elements, "  "));
			lines.push("");
		}
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

function renderElement(
	id: string,
	elements: Record<string, WireframeElementNode>,
	indent: string,
): string[] {
	const node = elements[id];
	if (!node) return [];

	const parts: string[] = [];
	switch (node.nodeKind) {
		case "screen":
			parts.push("screen");
			if (node.screenName) parts.push(node.screenName);
			if (node.viewport) parts.push(node.viewport);
			if (node.state) parts.push(`[${node.state}]`);
			break;
		case "repeat":
			parts.push("repeat", node.componentName || "MissingComponent");
			break;
		case "modal":
			parts.push("modal", node.componentName || "MissingComponent");
			break;
		case "component":
			parts.push(node.componentName || "MissingComponent");
			if (node.content) {
				parts.push(
					node.content.startsWith("$") ? node.content : `"${node.content}"`,
				);
			}
			break;
		default:
			return [];
	}

	if (node.declaredId) {
		parts.push(`id=${renderAttributeValue(node.declaredId)}`);
	}

	for (const [key, value] of Object.entries(node.attributes)) {
		parts.push(`${key}=${renderAttributeValue(value)}`);
	}

	parts.push(...node.flags);

	if (node.targetKind && node.target) {
		parts.push(`-->|${node.targetKind}|`, node.target);
	}

	const lines = [`${indent}${parts.join(" ")}`];
	if (
		node.nodeKind === "screen" ||
		(node.nodeKind === "component" && (node.children?.length || 0) > 0)
	) {
		for (const childId of node.children || []) {
			lines.push(...renderElement(childId, elements, `${indent}  `));
		}
		lines.push(`${indent}end`);
	}

	return lines;
}

function renderAttributeValue(value: string): string {
	return /[\s"]/u.test(value) ? `"${value}"` : value;
}

export function wireflowToPlaintext(ast: WireflowAST): string {
	const lines = ["wireflow"];

	for (const id of ast.order) {
		lines.push("");

		const screen = ast.screens[id];
		if (screen) {
			if (screen.ref) {
				const bindings = Object.entries(screen.bindings);
				lines.push(`  ref ${screen.screenName}`);
				for (const [hook, target] of bindings) {
					lines.push(`    ${hook} --> ${target}`);
				}
				if (bindings.length > 0) {
					lines.push("  end");
				}
			} else {
				lines.push(`  screen ${screen.screenName}`);
				lines.push("  end");
			}
			continue;
		}

		const decision = ast.decisions[id];
		if (decision) {
			lines.push(`  decision "${decision.question}"`);
			for (const branch of decision.branches) {
				lines.push(`    ${branch.label} --> ${branch.target}`);
			}
			lines.push("  end");
		}
	}

	lines.push("");
	lines.push("end");
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}
