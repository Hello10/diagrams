import { DiagramRenderer } from "../../DiagramRenderer.ts";
import { FONT_MONO } from "../../style.ts";
import { svgEsc } from "../../svg.ts";
import { getWireframeLibraryAdapter } from "./wireframeAdapters.ts";
import { wireframeToPlaintext } from "./wireframeToPlaintext.ts";
import type {
	WireframeAST,
	WireframeCanonicalRenderType,
	WireframeComponentRef,
	WireframeElementNode,
	WireframeLibraryComponentAdapter,
} from "./wireframeTypes.ts";

const GRID = 8;

type RenderedBlock = { svg: string; height: number };

// ─── Class entry point ──────────────────────────────────────────────────────

export class WireframeRenderer extends DiagramRenderer<WireframeAST> {
	protected readonly width: number;
	protected readonly height: number;
	private readonly body: string;

	constructor(ast: WireframeAST) {
		super(ast);
		const rootNode = ast.elements[ast.root];
		if (!rootNode) {
			this.width = 0;
			this.height = 0;
			this.body = "";
			return;
		}

		const parts: string[] = [];
		let cy = GRID * 5;

		for (const id of rootNode.children || []) {
			const node = ast.elements[id];
			if (node?.nodeKind !== "screen") continue;
			const { svg, height } = this.renderNode(
				node,
				ast,
				GRID * 5,
				cy,
				320,
				new Set(),
			);
			parts.push(svg);
			cy += height + GRID * 12;
		}

		let renderedDefinitions = false;
		for (const name of Object.keys(ast.defines)) {
			if (!renderedDefinitions) {
				parts.push(
					`<text x="${GRID * 5}" y="${cy}" font-size="16" font-weight="900">Components</text>`,
				);
				parts.push(
					`<line x1="${GRID * 5}" y1="${cy + 8}" x2="${GRID * 40}" y2="${cy + 8}" stroke="#eee" />`,
				);
				cy += GRID * 8;
				renderedDefinitions = true;
			}
			const { svg, height } = this.renderDefinition(name, ast, GRID * 5, cy);
			parts.push(svg);
			cy += height + GRID * 10;
		}

		this.width = 420;
		this.height = cy + GRID * 5;
		this.body = parts.join("\n");
	}

	protected renderBody(): string {
		return this.body;
	}

	protected override extraTextStyles(): string {
		return "fill: #000; cursor: default; user-select: none;";
	}

	toPlaintext(): string {
		return wireframeToPlaintext(this.ast);
	}

	/** Wireframe-only ASCII variant of `render()`. Not part of the base class
	 * contract — this is a wireframe convenience renderer used by the dash
	 * package and CLI tooling. */
	renderAscii(): string {
		const ast = this.ast;
		const lines: string[] = [];
		const rootNode = ast.elements[ast.root];
		if (!rootNode) return "";

		for (const id of rootNode.children || []) {
			const node = ast.elements[id];
			if (node?.nodeKind !== "screen") continue;
			lines.push(...this.renderAsciiNode(node, ast, 0, new Set()));
			lines.push("");
		}

		const defineNames = Object.keys(ast.defines);
		if (defineNames.length > 0) {
			lines.push("Components");
			for (const name of defineNames) {
				lines.push(`- ${name}`);
				const template = ast.defines[name]?.template ?? [];
				for (const templateId of template) {
					const node = ast.elements[templateId];
					if (!node) continue;
					lines.push(...this.renderAsciiNode(node, ast, 1, new Set([name])));
				}
			}
		}

		return lines.join("\n").trimEnd();
	}

	private renderNode(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		switch (node.nodeKind) {
			case "screen":
				return this.renderScreen(node, ast, x, y, width, trail);
			case "repeat":
				return this.renderRepeat(node, ast, x, y, width, trail);
			case "modal":
				return this.renderModal(node, ast, x, y, width, trail);
			case "component":
				return this.renderComponent(node, ast, x, y, width, trail);
			default:
				return this.renderGenericLeaf(node.type, x, y, width);
		}
	}

	private renderDefinition(
		name: string,
		ast: WireframeAST,
		x: number,
		y: number,
	): RenderedBlock {
		const def = ast.defines[name];
		if (!def) {
			return { svg: "", height: 0 };
		}
		let cy = y + GRID * 3;
		const parts = [
			`<text x="${x}" y="${y}" font-size="14" font-weight="900">${svgEsc(name)}</text>`,
		];

		for (const templateId of def.template) {
			const node = ast.elements[templateId];
			if (!node) continue;
			const rendered = this.renderNode(node, ast, x, cy, 320, new Set([name]));
			parts.push(rendered.svg);
			cy += rendered.height + GRID * 2;
		}

		return { svg: parts.join("\n"), height: cy - y };
	}

	private renderScreen(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const contentIds = (node.children || []).filter(
			(childId) => ast.elements[childId]?.nodeKind !== "modal",
		);
		const modalIds = (node.children || []).filter(
			(childId) => ast.elements[childId]?.nodeKind === "modal",
		);

		const padding = GRID * 3;
		const labelSvg = `<text x="${x}" y="${y - 12}" font-size="16" font-weight="900">${svgEsc(node.screenName || "Screen")}</text>`;
		const content = this.renderChildren(
			contentIds,
			ast,
			x + padding,
			y + padding,
			width - padding * 2,
			trail,
		);
		const frameHeight = Math.max(content.height + padding * 2, 120);

		const parts: string[] = [
			labelSvg,
			`<rect x="${x}" y="${y}" width="${width}" height="${frameHeight}" fill="white" stroke="#333" stroke-width="1.5" />`,
			content.svg,
		];

		for (const modalId of modalIds) {
			const modalNode = ast.elements[modalId];
			if (!modalNode) continue;
			const modalWidth = Math.min(
				width - GRID * 10,
				Math.max(Math.floor(width * 0.72), 220),
			);
			const measured = this.renderModal(
				modalNode,
				ast,
				0,
				0,
				modalWidth,
				trail,
			);
			const overlayX = x + Math.max((width - modalWidth) / 2, GRID * 3);
			const overlayY =
				y + Math.max((frameHeight - measured.height) / 4, GRID * 6);
			const rendered = this.renderModal(
				modalNode,
				ast,
				overlayX,
				overlayY,
				modalWidth,
				trail,
			);
			parts.push(
				`<rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${frameHeight - 2}" fill="rgba(0,0,0,0.06)" stroke="none" rx="2" />`,
			);
			parts.push(rendered.svg);
		}

		return { svg: parts.join("\n"), height: frameHeight };
	}

	private renderChildren(
		childIds: string[],
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const parts: string[] = [];
		let cy = y;

		for (const childId of childIds) {
			const child = ast.elements[childId];
			if (!child) continue;
			const rendered = this.renderNode(
				child,
				ast,
				x,
				cy,
				width,
				new Set(trail),
			);
			parts.push(rendered.svg);
			cy += rendered.height + GRID * 2;
		}

		return { svg: parts.join("\n"), height: Math.max(cy - y - GRID * 2, 0) };
	}

	private renderComponent(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		if (node.component?.kind === "local") {
			return this.renderLocalDefinition(node, ast, x, y, width, trail);
		}

		const adapter = this.getComponentAdapter(node.component);
		if (adapter?.renderSvg) {
			const childRender = this.renderChildren(
				node.children || [],
				ast,
				x + GRID * 2,
				y + GRID * 4,
				width - GRID * 4,
				trail,
			);
			const height = Math.max(
				childRender.height + GRID * 6,
				node.children?.length ? 80 : GRID * 6,
			);
			const svg = adapter.renderSvg({
				ast,
				node,
				label: this.visibleLabel(node),
				x,
				y,
				width,
				height,
				childrenSvg: childRender.svg,
			});
			return { svg, height };
		}

		if (adapter?.type) {
			return this.renderCanonicalType(
				adapter.type,
				node,
				ast,
				x,
				y,
				width,
				trail,
			);
		}

		if ((node.children?.length || 0) > 0) {
			return this.renderGenericContainer(node, ast, x, y, width, trail);
		}

		return this.renderGenericLeaf(
			node.componentName || "Component",
			x,
			y,
			width,
		);
	}

	private renderLocalDefinition(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const name = node.componentName || "Component";
		if (trail.has(name)) {
			return this.renderGenericLeaf(`Recursive ${name}`, x, y, width);
		}

		const def = ast.defines[name];
		if (!def) {
			return this.renderGenericLeaf(name, x, y, width);
		}

		const nextTrail = new Set(trail);
		nextTrail.add(name);
		return this.renderChildren(def.template, ast, x, y, width, nextTrail);
	}

	private renderRepeat(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const proxy = this.createProxyComponent(node);
		const representative = this.renderComponent(
			proxy,
			ast,
			x + GRID,
			y + GRID * 3,
			width - GRID * 2,
			trail,
		);
		const height = representative.height + GRID * 4;
		const svg = [
			`<text x="${x}" y="${y + 8}" font-family="${FONT_MONO}" font-size="10" fill="#777">repeat ${svgEsc(node.componentName || "Component")}</text>`,
			`<rect x="${x + 6}" y="${y + GRID * 3 + 6}" width="${width - GRID * 2}" height="${representative.height}" fill="white" stroke="#ddd" />`,
			`<rect x="${x + 3}" y="${y + GRID * 3 + 3}" width="${width - GRID * 2}" height="${representative.height}" fill="white" stroke="#ccc" />`,
			representative.svg,
		].join("\n");
		return { svg, height };
	}

	private renderModal(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const proxy = this.createProxyComponent(node);
		const content = this.renderComponent(proxy, ast, x, y, width, trail);
		const height = Math.max(content.height, 120);
		const svg = [
			`<text x="${x}" y="${y - 8}" font-family="${FONT_MONO}" font-size="10" fill="#666">modal ${svgEsc(node.componentName || "Component")}</text>`,
			content.svg,
		].join("\n");
		return { svg, height };
	}

	private renderCanonicalType(
		type: WireframeCanonicalRenderType,
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		switch (type) {
			case "text":
				return this.renderText(node, x, y, width);
			case "button":
				return this.renderButton(node, x, y, width);
			case "input":
			case "select":
				return this.renderInputLike(node, x, y, width, type);
			case "checkbox":
			case "radio":
				return this.renderChoice(node, x, y, width, type);
			case "image":
				return this.renderMedia(node, x, y, width, "Image", 0.58);
			case "audio":
				return this.renderMedia(node, x, y, width, "Audio", 0.32);
			case "video":
				return this.renderMedia(node, x, y, width, "Video", 0.58);
			case "table":
				return this.renderTable(node, ast, x, y, width, trail);
			case "dialog":
				return this.renderDialog(node, ast, x, y, width, trail);
		}
	}

	private renderGenericContainer(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const padding = GRID * 2;
		const children = this.renderChildren(
			node.children || [],
			ast,
			x + padding,
			y + padding * 2,
			width - padding * 2,
			trail,
		);
		const height = Math.max(children.height + padding * 4, 72);
		const label = this.visibleLabel(node);
		const svg = [
			`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#555" rx="4" />`,
			`<text x="${x + 6}" y="${y + 11}" font-family="${FONT_MONO}" font-size="9" fill="#777">${svgEsc(label)}</text>`,
			children.svg,
		].join("\n");
		return { svg, height };
	}

	private renderGenericLeaf(
		label: string,
		x: number,
		y: number,
		width: number,
	): RenderedBlock {
		const height = GRID * 6;
		return {
			svg: [
				`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#555" rx="4" />`,
				`<text x="${x + width / 2}" y="${y + height / 2 + 5}" text-anchor="middle">${svgEsc(label)}</text>`,
			].join("\n"),
			height,
		};
	}

	private renderText(
		node: WireframeElementNode,
		x: number,
		y: number,
		_width: number,
	): RenderedBlock {
		const label = this.clean(node.content || this.visibleLabel(node));
		const lines = label.split("\\n");
		const size =
			node.attributes.size === "lg"
				? 18
				: node.attributes.size === "sm"
					? 12
					: 14;
		const svg = lines
			.map(
				(line, index) =>
					`<text x="${x}" y="${y + size + index * size * 1.35}" font-size="${size}">${svgEsc(line)}</text>`,
			)
			.join("\n");
		return { svg, height: Math.max(lines.length * size * 1.35, 18) };
	}

	private renderButton(
		node: WireframeElementNode,
		x: number,
		y: number,
		width: number,
	): RenderedBlock {
		const label = this.clean(
			node.content || this.visibleLabel(node) || "Button",
		);
		const height = GRID * 5;
		return {
			svg: [
				`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="white" stroke="#333" stroke-width="1.2" />`,
				`<text x="${x + width / 2}" y="${y + height / 2 + 5}" text-anchor="middle" font-weight="bold">${svgEsc(label)}</text>`,
			].join("\n"),
			height,
		};
	}

	private renderInputLike(
		node: WireframeElementNode,
		x: number,
		y: number,
		width: number,
		type: "input" | "select",
	): RenderedBlock {
		const label = this.clean(
			node.content || node.attributes.placeholder || this.capitalize(type),
		);
		const height = GRID * 5;
		return {
			svg: [
				`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="white" stroke="#bbb" />`,
				`<text x="${x + 10}" y="${y + height / 2 + 4}" fill="#999">${svgEsc(label)}</text>`,
				type === "select"
					? `<text x="${x + width - 18}" y="${y + height / 2 + 4}" fill="#999">v</text>`
					: "",
			].join("\n"),
			height,
		};
	}

	private renderChoice(
		node: WireframeElementNode,
		x: number,
		y: number,
		_width: number,
		type: "checkbox" | "radio",
	): RenderedBlock {
		const label = this.clean(node.content || this.visibleLabel(node));
		const size = 14;
		const marker =
			type === "checkbox"
				? `<rect x="${x}" y="${y + 2}" width="${size}" height="${size}" fill="white" stroke="#555" />`
				: `<circle cx="${x + size / 2}" cy="${y + size / 2 + 2}" r="${size / 2}" fill="white" stroke="#555" />`;
		return {
			svg: `${marker}<text x="${x + size + 8}" y="${y + 15}">${svgEsc(label || this.capitalize(type))}</text>`,
			height: 20,
		};
	}

	private renderMedia(
		node: WireframeElementNode,
		x: number,
		y: number,
		width: number,
		label: string,
		aspect: number,
	): RenderedBlock {
		const height = Math.max(Math.round(width * aspect), 44);
		return {
			svg: [
				`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#ddd" />`,
				`<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="#ddd" />`,
				`<line x1="${x + width}" y1="${y}" x2="${x}" y2="${y + height}" stroke="#ddd" />`,
				`<text x="${x + 6}" y="${y + 12}" font-size="9" fill="#999">${svgEsc(label)}</text>`,
				node.content
					? `<text x="${x + 6}" y="${y + height - 8}" font-size="9" fill="#999">${svgEsc(this.clean(node.content))}</text>`
					: "",
			].join("\n"),
			height,
		};
	}

	private renderTable(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const children = this.renderChildren(
			node.children || [],
			ast,
			x + GRID * 2,
			y + GRID * 4,
			width - GRID * 4,
			trail,
		);
		const height = Math.max(children.height + GRID * 6, 76);
		const rowsY = y + GRID * 4;
		return {
			svg: [
				`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#555" />`,
				`<text x="${x + 6}" y="${y + 11}" font-family="${FONT_MONO}" font-size="9" fill="#777">Table</text>`,
				`<line x1="${x}" y1="${rowsY}" x2="${x + width}" y2="${rowsY}" stroke="#bbb" />`,
				children.svg ||
					`<line x1="${x}" y1="${rowsY + 18}" x2="${x + width}" y2="${rowsY + 18}" stroke="#ddd" />`,
			].join("\n"),
			height,
		};
	}

	private renderDialog(
		node: WireframeElementNode,
		ast: WireframeAST,
		x: number,
		y: number,
		width: number,
		trail: Set<string>,
	): RenderedBlock {
		const children = this.renderChildren(
			node.children || [],
			ast,
			x + GRID * 2,
			y + GRID * 4,
			width - GRID * 4,
			trail,
		);
		const height = Math.max(children.height + GRID * 6, 88);
		return {
			svg: [
				`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white" stroke="#333" stroke-width="1.4" rx="6" />`,
				`<text x="${x + 6}" y="${y + 11}" font-family="${FONT_MONO}" font-size="9" fill="#777">Dialog</text>`,
				children.svg,
			].join("\n"),
			height,
		};
	}

	private renderAsciiNode(
		node: WireframeElementNode,
		ast: WireframeAST,
		depth: number,
		trail: Set<string>,
	): string[] {
		const indent = "  ".repeat(depth);
		switch (node.nodeKind) {
			case "screen": {
				const lines = [
					`${indent}screen ${node.screenName || "Screen"}${node.state ? ` [${node.state}]` : ""}`,
				];
				for (const childId of node.children || []) {
					const child = ast.elements[childId];
					if (!child) continue;
					lines.push(
						...this.renderAsciiNode(child, ast, depth + 1, new Set(trail)),
					);
				}
				return lines;
			}
			case "repeat":
				return [
					`${indent}repeat ${node.componentName}${node.declaredId ? ` id=${node.declaredId}` : ""}`,
				];
			case "modal":
				return [
					`${indent}modal ${node.componentName}${node.declaredId ? ` id=${node.declaredId}` : ""}`,
				];
			case "component":
				return this.renderAsciiComponent(node, ast, depth, trail);
			default:
				return [`${indent}${node.type}`];
		}
	}

	private renderAsciiComponent(
		node: WireframeElementNode,
		ast: WireframeAST,
		depth: number,
		trail: Set<string>,
	): string[] {
		const indent = "  ".repeat(depth);
		if (node.component?.kind === "local") {
			const name = node.component.name;
			if (trail.has(name)) {
				return [`${indent}${name} (recursive)`];
			}
			const def = ast.defines[name];
			if (!def) return [`${indent}${name}`];
			const lines = [`${indent}${name}`];
			const nextTrail = new Set(trail);
			nextTrail.add(name);
			for (const childId of def.template) {
				const child = ast.elements[childId];
				if (!child) continue;
				lines.push(...this.renderAsciiNode(child, ast, depth + 1, nextTrail));
			}
			return lines;
		}

		const adapter = this.getComponentAdapter(node.component);
		if (adapter?.renderAscii) {
			return [
				`${indent}${adapter.renderAscii({
					ast,
					node,
					label: this.visibleLabel(node),
				})}`,
			];
		}

		if (adapter?.type) {
			return [`${indent}${this.renderAsciiCanonicalType(adapter.type, node)}`];
		}

		const header = `${indent}${node.componentName}${node.declaredId ? ` id=${node.declaredId}` : ""}`;
		if ((node.children?.length || 0) === 0) return [header];

		const lines = [header];
		for (const childId of node.children || []) {
			const child = ast.elements[childId];
			if (!child) continue;
			lines.push(...this.renderAsciiNode(child, ast, depth + 1, trail));
		}
		return lines;
	}

	private renderAsciiCanonicalType(
		type: WireframeCanonicalRenderType,
		node: WireframeElementNode,
	): string {
		const label = this.clean(node.content || this.visibleLabel(node));
		switch (type) {
			case "text":
				return `text "${label}"`;
			case "button":
				return `[button] ${label || "Button"}`;
			case "input":
				return `[input] ${label || "Input"}`;
			case "select":
				return `[select] ${label || "Select"}`;
			case "checkbox":
				return `[checkbox] ${label || "Checkbox"}`;
			case "radio":
				return `[radio] ${label || "Radio"}`;
			case "image":
				return `[image] ${label || node.componentName || "Image"}`;
			case "audio":
				return `[audio] ${label || node.componentName || "Audio"}`;
			case "video":
				return `[video] ${label || node.componentName || "Video"}`;
			case "table":
				return `[table] ${label || node.componentName || "Table"}`;
			case "dialog":
				return `[dialog] ${label || node.componentName || "Dialog"}`;
		}
	}

	private getComponentAdapter(
		ref: WireframeComponentRef | undefined,
	): WireframeLibraryComponentAdapter | undefined {
		if (!ref || ref.kind === "local") return undefined;
		const adapter = getWireframeLibraryAdapter(ref.module);
		if (!adapter) return undefined;
		return adapter.components[ref.name];
	}

	private createProxyComponent(
		node: WireframeElementNode,
	): WireframeElementNode {
		return {
			id: `${node.id}__proxy`,
			type: "component",
			nodeKind: "component",
			componentName: node.componentName,
			component: node.component,
			declaredId: node.declaredId,
			attributes: { ...node.attributes },
			flags: [...node.flags],
			content: node.content,
			targetKind: node.targetKind,
			target: node.target,
		};
	}

	private visibleLabel(node: WireframeElementNode): string {
		return this.clean(
			node.content || node.componentName || node.screenName || node.type,
		);
	}

	private clean(value: string): string {
		return value.replace(/^["']+|["']+$/g, "");
	}

	private capitalize(value: string): string {
		return value[0] ? value[0].toUpperCase() + value.slice(1) : value;
	}
}
