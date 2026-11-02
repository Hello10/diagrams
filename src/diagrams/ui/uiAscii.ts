import {
	frameViews,
	type LNode,
	SCREEN_WIDTH,
	type UiFrameEngine,
	viewLabel,
} from "./uiFrame.ts";
import type { UiAST } from "./uiTypes.ts";

/** Text rendering of the same expanded trees the storyboard draws. */
export function renderUiAsciiText(ast: UiAST, engine: UiFrameEngine): string {
	const lines: string[] = [];
	for (const name of ast.order) {
		const component = ast.components[name];
		if (!component) continue;
		for (const view of frameViews(component, ast)) {
			const frame = engine.buildFrame(component, view, SCREEN_WIDTH);
			const kind =
				component.route !== undefined
					? "screen"
					: component.isLayout
						? "layout"
						: "component";
			const label = viewLabel(view);
			lines.push(`${kind} ${name}${label ? ` ${label}` : ""}`);
			for (const child of frame.content.children)
				lines.push(...asciiNode(ast, engine, child, 1));
			for (const modal of frame.modals) {
				lines.push("  modal");
				lines.push(...asciiNode(ast, engine, modal, 2));
			}
			lines.push("");
		}
	}
	return lines.join("\n").trimEnd();
}

// ─── Frames ────────────────────────────────────────────────────────────────

function asciiNode(
	ast: UiAST,
	engine: UiFrameEngine,
	n: LNode,
	depth: number,
): string[] {
	const indent = "  ".repeat(depth);
	const id = n.id ? ` #${n.id}` : "";
	const flags = [...n.flags].filter((f) => f !== "hidden");
	const flagText = flags.length > 0 ? ` (${flags.join(", ")})` : "";
	const tail = `${id}${flagText}`;
	const label = n.label;

	if (n.kind === "stack") {
		if (n.repeatCount && n.repeatItem) {
			return [
				`${indent}list x${n.repeatCount} ${n.direction}${tail}`,
				...asciiNode(ast, engine, n.repeatItem, depth + 1),
			];
		}
		const head =
			n.name && n.name !== "Stack"
				? `${indent}${n.name} ${n.direction}${tail}`
				: `${indent}${n.direction}${tail}`;
		return [
			head,
			...n.children.flatMap((c) => asciiNode(ast, engine, c, depth + 1)),
		];
	}
	if (n.kind === "custom" && n.adapter?.renderAscii) {
		return [
			`${indent}${n.adapter.renderAscii({ ast: ast, node: n.source, label: n.label || n.title })}${tail}`,
		];
	}
	if (n.kind === "box" || n.kind === "custom" || n.kind === "outlet") {
		return [
			`${indent}${n.title}${tail}`,
			...n.children.flatMap((c) => asciiNode(ast, engine, c, depth + 1)),
		];
	}
	let head: string;
	switch (n.kind) {
		case "text":
		case "heading":
		case "link":
			head = `${indent}[${n.kind}] ${label}`;
			break;
		case "input":
		case "select":
			head =
				`${indent}[${n.kind}] ${label || n.props.placeholder || n.props.label || ""}`.trimEnd();
			break;
		case "table":
			head = `${indent}[table] ${engine.tableColumns(n).join(" | ")}`;
			break;
		default:
			head = `${indent}[${n.kind}] ${label}`.trimEnd();
	}
	return [
		`${head}${tail}`,
		...n.children.flatMap((c) => asciiNode(ast, engine, c, depth + 1)),
	];
}
