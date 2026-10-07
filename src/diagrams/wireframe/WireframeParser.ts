import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult, Token } from "../../types.ts";
import type {
	DefineNode,
	WireflowAST,
	WireflowDecision,
	WireflowScreen,
	WireframeAST,
	WireframeComponentRef,
	WireframeElementNode,
	WireframeInteractionKind,
	WireframeUseImport,
} from "./wireframeTypes.ts";

const WIREFLOW_ONLY_KEYWORDS = new Set(["ref", "decision"]);
const LEGACY_WIREFRAME_KEYWORDS = new Set([
	"list",
	"grid",
	"table",
	"external",
]);

type ParsedProperties = {
	attributes: Record<string, string>;
	flags: string[];
	targetKind?: WireframeInteractionKind;
	target?: string;
};

export class WireframeParser extends DiagramParser<WireframeAST | WireflowAST> {
	private elements: Record<string, WireframeElementNode> = {};
	private parents: Record<string, string | undefined> = {};
	private defines: Record<string, DefineNode> = {};
	private uses: WireframeUseImport[] = [];

	private screens: Record<string, WireflowScreen> = {};
	private decisions: Record<string, WireflowDecision> = {};
	private order: string[] = [];

	private currentDiagramType: "wireframe" | "wireflow" = "wireframe";
	private idCounters: Record<string, number> = {};

	parse(): ParseResult<WireframeAST | WireflowAST> {
		this.skipTrivia();
		const first = this.peek();

		if (first?.type === "identifier") {
			if (first.value === "wireframe") {
				this.currentDiagramType = "wireframe";
				this.consume();
				this.consumeIf("newline");
			} else if (first.value === "wireflow") {
				this.currentDiagramType = "wireflow";
				this.consume();
				this.consumeIf("newline");
			}
		}

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const token = this.peek();
			if (!token) break;

			if (token.type === "identifier" && token.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			}

			if (this.currentDiagramType === "wireframe") {
				this.parseWireframeStatement("root");
			} else {
				this.parseWireflowStatement();
			}
		}

		if (this.currentDiagramType === "wireflow") {
			return this.result({
				type: "wireflow",
				order: this.order,
				screens: this.screens,
				decisions: this.decisions,
			});
		}

		const rootNode: WireframeElementNode = {
			id: "root",
			type: "root",
			nodeKind: "root",
			attributes: {},
			flags: [],
			children: Object.keys(this.elements).filter(
				(id) => this.elements[id]?.nodeKind === "screen",
			),
		};
		this.elements[rootNode.id] = rootNode;

		const ast: WireframeAST = {
			type: "wireframe",
			root: rootNode.id,
			elements: this.elements,
			defines: this.defines,
			uses: this.uses,
		};

		this.validateWireframe(ast);
		return this.result(ast);
	}

	private parseWireframeStatement(parentId: string): void {
		this.skipTrivia();
		const token = this.peek();
		if (token?.type !== "identifier") return;

		switch (token.value) {
			case "use":
				if (parentId !== "root") {
					this.error(
						"use declarations are only valid at the top level of a wireframe",
						token,
					);
				}
				this.parseUse();
				return;
			case "define":
				if (parentId !== "root") {
					this.error(
						"define blocks are only valid at the top level of a wireframe",
						token,
					);
				}
				this.parseDefine();
				return;
			case "screen":
				if (parentId !== "root") {
					this.error(
						"screen declarations are only valid at the top level of a wireframe",
						token,
					);
				}
				this.parseScreen(parentId);
				return;
			case "repeat":
				this.parseRepeat(parentId);
				return;
			case "modal":
				this.parseModal(parentId);
				return;
		}

		if (WIREFLOW_ONLY_KEYWORDS.has(token.value)) {
			this.error(`"${token.value}" belongs to wireflow, not wireframe`, token);
			this.skipToEndOfLine();
			return;
		}

		if (LEGACY_WIREFRAME_KEYWORDS.has(token.value)) {
			this.error(
				`"${token.value}" is legacy wireframe syntax; use imported components plus repeat/modal instead`,
				token,
			);
			this.skipToEndOfLine();
			return;
		}

		if (!this.looksLikeComponentReference(token.value)) {
			this.error(
				`Unknown wireframe keyword or invalid component reference "${token.value}"`,
				token,
			);
			this.skipToEndOfLine();
			return;
		}

		this.parseComponent(parentId);
	}

	private parseUse(): void {
		this.consume("identifier", "use");
		const moduleToken = this.consume("identifier");
		const moduleName = moduleToken.value;

		const next = this.peek();
		if (next?.type === "identifier" && next.value === "as") {
			this.consume("identifier", "as");
			const alias = this.consume("identifier").value;
			this.uses.push({ kind: "namespace", module: moduleName, alias });
			this.consumeIf("newline");
			return;
		}

		const names: string[] = [];
		while (true) {
			const token = this.peek();
			if (!token || token.type === "newline") break;
			if (token.type === "identifier") {
				names.push(this.consume("identifier").value);
				continue;
			}
			this.error("Expected imported component name", token);
			this.consume();
		}

		if (names.length === 0) {
			this.error(
				"use declarations must import either a namespace alias or at least one named symbol",
				moduleToken,
			);
		} else {
			this.uses.push({ kind: "named", module: moduleName, names });
		}
		this.consumeIf("newline");
	}

	private parseScreen(parentId: string): void {
		this.consume("identifier", "screen");
		const screenNameToken = this.consume("identifier");
		const screenName = screenNameToken.value;
		const viewport = this.consumeIf("identifier")?.value;
		const stateToken = this.consumeIf("bracket");
		const state = stateToken ? stateToken.value.slice(1, -1) : undefined;
		const { attributes, flags, targetKind, target } =
			this.parseCommonProperties();

		const id = attributes.id || this.generateId("screen", screenName);
		const declaredId = attributes.id;
		delete attributes.id;

		const node: WireframeElementNode = {
			id,
			type: "screen",
			nodeKind: "screen",
			declaredId,
			attributes,
			flags,
			screenName,
			viewport,
			state,
			targetKind,
			target,
		};
		this.elements[id] = node;
		this.linkNode(parentId, id);
		this.parseBlock(id);
	}

	private parseComponent(parentId: string): void {
		const componentToken = this.consume("identifier");
		const componentName = componentToken.value;

		let content: string | undefined;
		const next = this.peek();
		if (next?.type === "string") {
			content = this.consume("string").value;
		} else if (next?.type === "identifier" && next.value.startsWith("$")) {
			content = this.consume("identifier").value;
		}

		const { attributes, flags, targetKind, target } =
			this.parseCommonProperties({
				deriveIdFrom: componentName,
			});

		const id =
			attributes.id ||
			this.generateId(
				"component",
				this.unqualifiedComponentName(componentName),
			);
		const declaredId = attributes.id;
		delete attributes.id;

		const node: WireframeElementNode = {
			id,
			type: "component",
			nodeKind: "component",
			declaredId,
			componentName,
			content,
			attributes,
			flags,
			targetKind,
			target,
		};
		this.elements[id] = node;
		this.linkNode(parentId, id);

		if (this.hasIndentedBlockAhead()) {
			this.parseBlock(id);
		}
	}

	private parseRepeat(parentId: string): void {
		const keyword = this.consume("identifier", "repeat");
		const componentToken = this.consume("identifier");
		const componentName = componentToken.value;
		const { attributes, flags, targetKind, target } =
			this.parseCommonProperties({
				deriveIdFrom: componentName,
			});

		const id =
			attributes.id ||
			this.generateId("repeat", this.unqualifiedComponentName(componentName));
		const declaredId = attributes.id;
		delete attributes.id;

		const node: WireframeElementNode = {
			id,
			type: "repeat",
			nodeKind: "repeat",
			declaredId,
			componentName,
			attributes,
			flags,
			targetKind,
			target,
		};
		this.elements[id] = node;
		this.linkNode(parentId, id);
		this.skipUnexpectedIndentedBlock("repeat", keyword);
	}

	private parseModal(parentId: string): void {
		const keyword = this.consume("identifier", "modal");
		if (!this.isWithinScreen(parentId)) {
			this.error("modal is only valid within a screen body", keyword);
		}
		const componentToken = this.consume("identifier");
		const componentName = componentToken.value;
		const { attributes, flags, targetKind, target } =
			this.parseCommonProperties({
				deriveIdFrom: componentName,
			});

		const id =
			attributes.id ||
			this.generateId("modal", this.unqualifiedComponentName(componentName));
		const declaredId = attributes.id;
		delete attributes.id;

		const node: WireframeElementNode = {
			id,
			type: "modal",
			nodeKind: "modal",
			declaredId,
			componentName,
			attributes,
			flags,
			targetKind,
			target,
		};
		this.elements[id] = node;
		this.linkNode(parentId, id);
		this.skipUnexpectedIndentedBlock("modal", keyword);
	}

	private parseDefine(): void {
		this.consume("identifier", "define");
		const nameToken = this.consume("identifier");
		const name = nameToken.value;
		this.consumeIf("newline");

		const syntheticParentId = `define-${name}`;
		const fakeParent: WireframeElementNode = {
			id: syntheticParentId,
			type: "component",
			nodeKind: "component",
			componentName: name,
			attributes: {},
			flags: [],
		};
		this.elements[syntheticParentId] = fakeParent;

		this.parseBlock(syntheticParentId);

		const template = fakeParent.children || [];
		const params = new Set<string>();
		const hooks = new Set<string>();
		const traverse = (ids: string[]) => {
			for (const id of ids) {
				const node = this.elements[id];
				if (!node) continue;
				if (node.content?.startsWith("$")) params.add(node.content.slice(1));
				if (node.targetKind === "call" && node.target) hooks.add(node.target);
				if (node.children) traverse(node.children);
			}
		};
		traverse(template);

		if (this.defines[name]) {
			this.error(`Duplicate define "${name}"`, nameToken);
		}

		this.defines[name] = {
			name,
			params: Array.from(params),
			hooks: Array.from(hooks),
			template,
		};
		delete this.elements[syntheticParentId];
		delete this.parents[syntheticParentId];
	}

	private parseCommonProperties(options?: {
		deriveIdFrom?: string;
	}): ParsedProperties {
		const attributes: Record<string, string> = {};
		const flags: string[] = [];
		let targetKind: WireframeInteractionKind | undefined;
		let target: string | undefined;
		let sawBareId = false;

		while (true) {
			const token = this.peek();
			if (!token || token.type === "newline") break;

			if (token.type === "attribute") {
				const eq = token.value.indexOf("=");
				attributes[token.value.slice(0, eq)] = token.value.slice(eq + 1);
				this.consume();
				continue;
			}

			if (token.type === "identifier") {
				if (token.value === "id") {
					sawBareId = true;
				} else {
					flags.push(token.value);
				}
				this.consume();
				continue;
			}

			if (token.type === "hook") {
				this.error(
					"Raw @hook references are legacy wireframe syntax; use `-->|call| HookName`",
					token,
				);
				this.consume();
				continue;
			}

			if (token.type === "labeled-arrow") {
				const arrowToken = this.consume();
				const kind = extractLabel(arrowToken.value);
				if (!this.isWireframeTargetKind(kind)) {
					this.error(
						`Expected goto, state, or call inside the typed-target label, got "${kind}"`,
						arrowToken,
					);
					continue;
				}
				targetKind = kind;
				const targetToken = this.peek();
				if (targetToken?.type === "identifier") {
					target = this.consume("identifier").value;
				} else {
					this.error(
						`Expected a target name after -->|${kind}|`,
						targetToken || arrowToken,
					);
				}
				continue;
			}

			if (token.type === "arrow") {
				this.error(
					"Wireframe interactions require a typed-target label: use `-->|goto|`, `-->|state|`, or `-->|call|`",
					token,
				);
				this.consume();
				const legacyTarget = this.peek();
				if (
					legacyTarget?.type === "identifier" ||
					legacyTarget?.type === "hook"
				) {
					this.consume();
				}
				continue;
			}

			break;
		}

		this.consumeIf("newline");

		if (sawBareId) {
			if (attributes.id) {
				this.error(
					"Cannot use bare id shorthand together with explicit id=...",
					this.peek(-1),
				);
			} else if (options?.deriveIdFrom) {
				attributes.id = this.deriveIdFromReference(options.deriveIdFrom);
			} else {
				this.error(
					"Bare id shorthand is only valid on component-backed constructs",
					this.peek(-1),
				);
			}
		}

		return { attributes, flags, targetKind, target };
	}

	private parseBlock(parentId: string): void {
		while (true) {
			this.skipTrivia();
			const token = this.peek();
			if (!token) break;

			if (token.type === "identifier" && token.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			}

			this.parseWireframeStatement(parentId);
		}
	}

	private hasIndentedBlockAhead(): boolean {
		for (let i = this.pos; i < this.tokens.length; i++) {
			const token = this.tokens[i];
			if (!token) continue;
			if (
				token.type === "newline" ||
				token.type === "comment" ||
				token.type === "directive"
			)
				continue;
			return token.type === "indent";
		}
		return false;
	}

	private skipUnexpectedIndentedBlock(
		kind: "repeat" | "modal",
		token: Token,
	): void {
		if (this.peek()?.type !== "indent") return;

		this.error(
			`${kind} cannot have inline children; reference a defined component instead`,
			token,
		);
		let depth = 0;
		while (true) {
			const current = this.peek();
			if (!current) break;
			this.pos++;
			if (current.type === "indent") {
				depth++;
				continue;
			}
			if (current.type === "dedent") {
				if (depth === 0) break;
				depth--;
				if (depth === 0) break;
			}
		}

		this.skipTrivia();
		if (this.peek()?.type === "identifier" && this.peek()?.value === "end") {
			this.consume();
			this.consumeIf("newline");
		}
	}

	private linkNode(parentId: string, childId: string): void {
		const parent = this.elements[parentId];
		if (!parent) return;
		parent.children = parent.children || [];
		parent.children.push(childId);
		this.parents[childId] = parentId;
	}

	private isWithinScreen(parentId: string): boolean {
		let current: string | undefined = parentId;
		while (current) {
			const node = this.elements[current];
			if (node?.nodeKind === "screen") return true;
			current = this.parents[current];
		}
		return false;
	}

	private validateWireframe(ast: WireframeAST): void {
		const namespaceImports = new Map<string, string>();
		const namedImports = new Map<string, string>();

		for (const use of ast.uses) {
			if (use.kind === "namespace") {
				const existing = namespaceImports.get(use.alias);
				if (existing) {
					this.error(
						`Duplicate namespace import alias "${use.alias}"`,
						this.findUseToken(use.alias),
					);
				}
				namespaceImports.set(use.alias, use.module);
				continue;
			}

			for (const name of use.names) {
				const existing = namedImports.get(name);
				if (existing) {
					this.error(
						`Duplicate named import "${name}"`,
						this.findUseToken(name),
					);
				}
				namedImports.set(name, use.module);
			}
		}

		for (const node of Object.values(ast.elements)) {
			if (!["component", "repeat", "modal"].includes(node.nodeKind)) continue;
			if (!node.componentName) continue;
			const resolved = this.resolveComponentReference(
				node.componentName,
				namespaceImports,
				namedImports,
			);
			if (resolved) {
				node.component = resolved;
			} else if (node.nodeKind === "repeat" || node.nodeKind === "modal") {
				this.error(
					`${node.nodeKind} must reference a concrete component symbol: "${node.componentName}"`,
					this.findComponentToken(node.componentName),
				);
			}
		}

		for (const screenId of ast.elements[ast.root]?.children || []) {
			const screen = ast.elements[screenId];
			if (screen?.nodeKind !== "screen") continue;

			const hooks = new Set<string>();
			const ids = new Map<string, string>();
			this.walkWireframeSubtree(screenId, (node) => {
				if (node.targetKind === "call" && node.target) hooks.add(node.target);
				if (node.component?.kind === "local") {
					for (const hook of this.defines[node.component.name]?.hooks || []) {
						hooks.add(hook);
					}
				}
				if (ids.has(node.id)) {
					this.error(
						`Duplicate id "${node.id}" within screen scope`,
						this.findIdToken(node.id),
					);
				} else {
					ids.set(node.id, node.id);
				}
			});
			screen.hooks = Array.from(hooks);
		}
	}

	private walkWireframeSubtree(
		id: string,
		visit: (node: WireframeElementNode) => void,
	): void {
		const node = this.elements[id];
		if (!node) return;
		visit(node);
		for (const childId of node.children || []) {
			this.walkWireframeSubtree(childId, visit);
		}
	}

	private resolveComponentReference(
		raw: string,
		namespaceImports: Map<string, string>,
		namedImports: Map<string, string>,
	): WireframeComponentRef | undefined {
		if (raw.includes(".")) {
			const [alias, ...rest] = raw.split(".");
			const name = rest.join(".");
			if (!alias) {
				this.error(
					`Invalid qualified component reference "${raw}"`,
					this.findComponentToken(raw),
				);
				return undefined;
			}
			const moduleName = namespaceImports.get(alias);
			if (!moduleName) {
				this.error(
					`Unknown namespace import alias "${alias}" in component reference "${raw}"`,
					this.findComponentToken(raw),
				);
				return undefined;
			}
			if (!name) {
				this.error(
					`Expected component export after namespace alias in "${raw}"`,
					this.findComponentToken(raw),
				);
				return undefined;
			}
			return { kind: "namespace-import", module: moduleName, alias, name };
		}

		if (this.defines[raw]) {
			return { kind: "local", name: raw };
		}

		const moduleName = namedImports.get(raw);
		if (moduleName) {
			return { kind: "named-import", module: moduleName, name: raw };
		}

		this.error(
			`Unresolved component reference "${raw}"`,
			this.findComponentToken(raw),
		);
		return undefined;
	}

	private findUseToken(value: string): Token | undefined {
		return this.tokens.find(
			(token) => token.type === "identifier" && token.value === value,
		);
	}

	private findComponentToken(value: string): Token | undefined {
		return this.tokens.find(
			(token) => token.type === "identifier" && token.value === value,
		);
	}

	private findIdToken(value: string): Token | undefined {
		return this.tokens.find(
			(token) =>
				(token.type === "attribute" && token.value === `id=${value}`) ||
				(token.type === "identifier" && token.value === "id"),
		);
	}

	private looksLikeComponentReference(value: string): boolean {
		if (value.includes(".")) return true;
		return /^[A-Z][A-Za-z0-9_$]*$/.test(value);
	}

	private isWireframeTargetKind(
		value: string,
	): value is WireframeInteractionKind {
		return value === "goto" || value === "state" || value === "call";
	}

	private unqualifiedComponentName(value: string): string {
		const parts = value.split(".");
		return parts[parts.length - 1] || value;
	}

	private deriveIdFromReference(value: string): string {
		const stem = this.unqualifiedComponentName(value);
		return stem ? stem[0]?.toLowerCase() + stem.slice(1) : value;
	}

	private slugify(value: string): string {
		return value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	private generateId(type: string, seed?: string): string {
		const stem = seed ? this.slugify(seed) : type;
		const base = `${type}-${stem}`;
		this.idCounters[base] = (this.idCounters[base] || 0) + 1;
		return `${base}-${this.idCounters[base] - 1}`;
	}

	private parseWireflowStatement(): void {
		this.skipTrivia();
		const t = this.peek();
		if (!t) return;

		if (t.type === "identifier" && t.value === "ref") {
			this.consume();
			const screenName = this.consume("identifier").value;
			this.consumeIf("newline");

			const bindings: Record<string, string> = {};
			const id = this.generateId("ref", screenName);
			this.order.push(id);

			while (true) {
				this.skipTrivia();
				const inner = this.peek();
				if (!inner) break;

				if (inner.type === "identifier" && inner.value === "end") {
					this.consume();
					this.consumeIf("newline");
					break;
				}

				if (inner.type === "hook") {
					const hookName = this.consume().value;
					let targetStr = "";

					const arrow = this.peek();
					if (arrow?.type === "arrow" || arrow?.type === "labeled-arrow") {
						this.consume();
						const target = this.peek();
						if (target?.type === "identifier") targetStr = this.consume().value;
					}
					bindings[hookName] = targetStr;
					this.consumeIf("newline");
				} else {
					break;
				}
			}

			this.screens[id] = {
				id,
				screenName,
				ref: screenName,
				inline: null,
				bindings,
			};
			return;
		}

		if (t.type === "identifier" && t.value === "screen") {
			this.consume();
			const screenName = this.consume("identifier").value;
			this.skipToEndOfLine();

			const id = this.generateId("screen", screenName);
			this.order.push(id);
			this.screens[id] = {
				id,
				screenName,
				ref: null,
				inline: {},
				bindings: {},
			};

			while (true) {
				this.skipTrivia();
				const inner = this.peek();
				if (!inner) break;
				if (inner.type === "identifier" && inner.value === "end") {
					this.consume();
					this.consumeIf("newline");
					break;
				}
				this.skipToEndOfLine();
			}
			return;
		}

		if (t.type === "identifier" && t.value === "decision") {
			this.consume();
			const question = this.consumeIf("string")?.value || "Decision";
			this.consumeIf("newline");

			const id = this.generateId("decision");
			this.order.push(id);
			const branches: { label: string; target: string }[] = [];

			while (true) {
				this.skipTrivia();
				const inner = this.peek();
				if (!inner || (inner.type === "identifier" && inner.value === "end")) {
					this.consumeIf("identifier");
					this.consumeIf("newline");
					break;
				}

				const label = this.consume("identifier").value;
				const arrow = this.peek();
				let target = "";
				if (arrow?.type === "arrow") {
					this.consume();
					const targetToken = this.peek();
					if (targetToken?.type === "identifier") target = this.consume().value;
				}
				branches.push({ label, target });
				this.consumeIf("newline");
			}

			this.decisions[id] = { id, question, branches };
			return;
		}

		this.skipToEndOfLine();
	}
}

/** Extract the inner label of a labeled-arrow token value: `-->|goto|` → `goto`. */
function extractLabel(arrowValue: string): string {
	const first = arrowValue.indexOf("|");
	const last = arrowValue.lastIndexOf("|");
	if (first === -1 || first === last) return "";
	let label = arrowValue.slice(first + 1, last);
	if (label.startsWith('"') && label.endsWith('"')) {
		label = label.slice(1, -1);
	}
	return label.trim();
}
