import {
	renderAction,
	renderArgs,
	renderCaseLabel,
	renderSwitch,
	renderHandler,
	type UiAST,
	type UiCase,
	type UiComponent,
	type UiIo,
	type UiNode,
	type UiOverride,
} from "./uiTypes.ts";

/** Canonical plaintext: `end` blocks throughout, declarations in the order
 * they were written, each component body as io, tree, then `when`. */
export function uiToPlaintext(ast: UiAST): string {
	const lines = ["ui"];
	if (ast.theme) {
		const pairs = Object.entries(ast.theme).map(([k, v]) => `${k}=${v}`);
		lines.push(`  %%{theme ${pairs.join(" ")}}%%`);
	}
	if (ast.title) lines.push(`  title ${ast.title}`);
	if (ast.accTitle) lines.push(`  accTitle ${ast.accTitle}`);
	if (ast.accDescr) lines.push(`  accDescr ${ast.accDescr}`);
	for (const use of ast.uses) {
		lines.push(
			use.kind === "namespace"
				? `  use "${use.module}" as ${use.alias}`
				: `  use "${use.module}" ${use.names.join(", ")}`,
		);
	}
	for (const api of ast.apis) {
		lines.push(
			`  api "${api.module}"${api.names.length ? ` ${api.names.join(", ")}` : ""}`,
		);
	}
	if (ast.io.length > 0) lines.push("");
	for (const io of ast.io) lines.push(...renderIo(io, "  "));
	lines.push("");

	for (const name of ast.order) {
		const component = ast.components[name];
		if (!component) continue;
		lines.push(...renderComponent(component, "  "));
		lines.push("");
	}

	lines.push("end");
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function renderComponent(c: UiComponent, indent: string): string[] {
	const params = c.params.length ? `(${c.params.join(", ")})` : "";
	let head: string;
	if (c.route !== undefined) {
		const layout =
			c.layoutName !== undefined
				? ` layout=${c.layoutName}${renderArgs(c.layoutArgs)}`
				: "";
		head = `${indent}screen ${c.name} route=${c.route}${layout}`;
	} else if (c.isLayout) {
		head = `${indent}layout ${c.name}${params}`;
	} else {
		head = `${indent}component ${c.name}${params}`;
	}
	for (const m of c.modes)
		head += ` @${m.name}${m.param ? `(${m.param})` : ""}`;
	const lines = [head];
	const inner = `${indent}  `;
	for (const io of c.io) lines.push(...renderIo(io, inner));
	if (c.io.length > 0 && c.tree.length > 0) lines.push("");
	for (const node of c.tree) lines.push(...renderNode(node, inner));
	for (const when of c.whens) {
		lines.push("");
		lines.push(...renderNode(when, inner));
	}
	lines.push(`${indent}end`);
	return lines;
}

function renderIo(io: UiIo, indent: string): string[] {
	const head = `${indent}${io.kind} ~${io.name}${renderArgs(io.args)}`;
	if (io.outcomes.length === 0) return [head];
	return [
		head,
		...io.outcomes.map(
			(o) => `${indent}  ${o.mode} => ${renderAction(o.action)}`,
		),
		`${indent}end`,
	];
}

export function renderNode(node: UiNode, indent: string): string[] {
	switch (node.kind) {
		case "modal":
			return [
				`${indent}modal`,
				...node.children.flatMap((c) => renderNode(c, `${indent}  `)),
				`${indent}end`,
			];
		case "list": {
			const attrs = Object.entries(node.attributes).map(
				([k, v]) => ` ${k}=${quote(v)}`,
			);
			return [
				`${indent}list ${node.data} as ${node.item}${attrs.join("")}`,
				...node.children.flatMap((c) => renderNode(c, `${indent}  `)),
				`${indent}end`,
			];
		}
		case "when":
			return renderWhen(node, indent);
		case "instance":
			break;
	}
	const parts: string[] = [`${node.name ?? "Missing"}${renderArgs(node.args)}`];
	if (node.content !== undefined) parts.push(`"${node.content}"`);
	if (node.id !== undefined) parts.push(`#${node.id}`);
	for (const [k, v] of Object.entries(node.attributes))
		parts.push(`${k}=${quote(v)}`);
	// Unresolved pairs/words (when the name did not resolve) still round-trip.
	for (const [k, v] of Object.entries(node.pairs)) {
		if (!(k in node.attributes)) parts.push(`${k}=${quote(v)}`);
	}
	for (const w of node.words) if (!node.flags.includes(w)) parts.push(w);
	parts.push(...node.flags);
	for (const h of node.handlers) parts.push(renderHandler(h));
	const lines = [`${indent}${parts.join(" ")}`];
	if (node.children.length > 0) {
		for (const child of node.children)
			lines.push(...renderNode(child, `${indent}  `));
		lines.push(`${indent}end`);
	}
	return lines;
}

function renderWhen(node: UiNode, indent: string): string[] {
	const lines = [`${indent}when ${renderSwitch(node.on)}`];
	for (const kase of node.cases ?? [])
		lines.push(...renderCase(kase, `${indent}  `));
	lines.push(`${indent}end`);
	return lines;
}

/** A case is `label { … }` when its body is one line (overrides, or one
 * tree line without a block); otherwise the label, its lines, and `end`. */
function renderCase(kase: UiCase, indent: string): string[] {
	const label = `${indent}${renderCaseLabel(kase.condition)}`;
	if (kase.overrides.length > 0) {
		return [`${label} { ${kase.overrides.map(renderOverride).join("; ")} }`];
	}
	const body = kase.nodes.flatMap((n) => renderNode(n, `${indent}  `));
	if (body.length === 1) return [`${label} { ${(body[0] ?? "").trim()} }`];
	return [label, ...body, `${indent}end`];
}

function renderOverride(o: UiOverride): string {
	const parts = [`#${o.handle}`];
	if (o.content !== undefined) parts.push(`"${o.content}"`);
	for (const [k, v] of Object.entries(o.attributes))
		parts.push(`${k}=${quote(v)}`);
	parts.push(...o.flags);
	if (o.mode)
		parts.push(
			`@${o.mode.mode}${o.mode.value !== undefined ? `(${o.mode.value})` : ""}`,
		);
	for (const h of o.handlers) parts.push(renderHandler(h));
	return parts.join(" ");
}

function quote(value: string): string {
	return /[\s"]/u.test(value) || value === "" ? `"${value}"` : value;
}
