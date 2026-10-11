import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult, Token } from "../../types.ts";
import {
	type DefineNode,
	WIREFRAME_DEFAULT_STATE,
	WIREFRAME_KNOWN_VIEWPORTS,
	WIREFRAME_UI_COMPONENTS,
	WIREFRAME_UI_MODULE,
	type WireframeAST,
	type WireframeComponentRef,
	type WireframeElementNode,
	type WireframeInteractionKind,
	type WireframeOverride,
	type WireframeScreenState,
	type WireframeUseImport,
	type WireframeViewport,
	type WireframeViewportOverrides,
} from "./wireframeTypes.ts";

/** Keywords of the wireframe grammar. Lowercase; everything PascalCase is a
 * component reference, everything else lowercase inside an override block is
 * a component id. */
const KEYWORDS = new Set([
	"wireframe",
	"use",
	"define",
	"viewport",
	"screen",
	"state",
	"repeat",
	"modal",
	"end",
]);

const WIREFLOW_ONLY_KEYWORDS = new Set(["ref", "decision", "entry", "exit"]);
const LEGACY_KEYWORDS = new Set(["list", "grid", "table", "external"]);

const STACK_DIRECTIONS = new Set(["row", "column"]);
const STACK_ALIGNS = new Set(["start", "center", "end", "stretch"]);
const STACK_JUSTIFIES = new Set(["start", "center", "end", "between"]);
const SIZING_WORDS = new Set(["fill", "hug"]);
const SPACING_WORDS = new Set(["none", "xs", "sm", "md", "lg", "xl", "xxl"]);

/** What `parseProperties` collects from the tail of a statement line. */
type ParsedProperties = {
	content?: string;
	attributes: Record<string, string>;
	flags: string[];
	clearFlags: string[];
	data?: string;
	targetKind?: WireframeInteractionKind;
	target?: string;
	/** Token of the interaction target, for state-target validation. */
	targetToken?: Token;
};

/** Where a statement sits, which decides what is legal there. */
type BlockContext =
	| { kind: "screen"; screenId: string }
	| { kind: "define" }
	| { kind: "container"; screenId?: string }
	| { kind: "state"; screenId: string; state: WireframeScreenState }
	| { kind: "viewport"; screenId: string; overrides: WireframeOverride[] };

export class WireframeParser extends DiagramParser<WireframeAST> {
	private elements: Record<string, WireframeElementNode> = {};
	private parents: Record<string, string | undefined> = {};
	private defines: Record<string, DefineNode> = {};
	private uses: WireframeUseImport[] = [];
	private viewports: WireframeViewport[] = [];
	private idCounters: Record<string, number> = {};
	private pendingMeta: {
		title?: string;
		accTitle?: string;
		accDescr?: string;
	} = {};

	/** Tokens of component references, by element id — for error reporting. */
	private componentTokens: Record<string, Token> = {};
	/** Tokens of `id=` attributes, by element id. */
	private idTokens: Record<string, Token> = {};
	/** Interaction target tokens for state-target validation. */
	private stateTargets: { screenId: string; target: string; token?: Token }[] =
		[];
	/** Override lines awaiting id resolution once the screen is complete. */
	private overrideTokens: {
		screenId: string;
		override: WireframeOverride;
		state?: WireframeScreenState;
		token: Token;
	}[] = [];

	parse(): ParseResult<WireframeAST> {
		this.skipTrivia();
		const first = this.peek();
		if (first?.type === "identifier" && first.value === "wireframe") {
			this.consume();
			this.skipToEndOfLine();
		}

		const root: WireframeElementNode = {
			id: "root",
			type: "root",
			nodeKind: "root",
			attributes: {},
			flags: [],
			children: [],
		};
		this.elements[root.id] = root;

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const token = this.peek();
			if (!token) break;
			if (token.type === "identifier" && token.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			}
			this.parseTopLevelStatement();
		}

		const ast: WireframeAST = {
			type: "wireframe",
			root: root.id,
			elements: this.elements,
			defines: this.defines,
			uses: this.uses,
			viewports: this.viewports,
		};

		this.validate(ast);
		return this.result(ast);
	}

	// ─── Top level ─────────────────────────────────────────────────────────────

	private parseTopLevelStatement(): void {
		const token = this.peek();
		if (!token) return;
		if (token.type !== "identifier") {
			this.error(`Unexpected ${token.type} at top level`, token);
			this.skipToEndOfLine();
			return;
		}

		switch (token.value) {
			case "use":
				this.parseUse();
				return;
			case "viewport":
				this.parseViewportDeclaration();
				return;
			case "define":
				this.parseDefine();
				return;
			case "screen":
				this.parseScreen();
				return;
			case "title":
				this.consume();
				this.parseTitleLike("title");
				return;
			case "accTitle":
				this.consume();
				this.parseTitleLike("accTitle");
				return;
			case "accDescr":
				this.consume();
				this.parseTitleLike("accDescr");
				return;
		}

		if (WIREFLOW_ONLY_KEYWORDS.has(token.value)) {
			this.error(`"${token.value}" belongs to wireflow, not wireframe`, token);
		} else if (token.value === "state" || token.value === "modal") {
			this.error(`"${token.value}" is only valid inside a screen`, token);
		} else if (token.value === "repeat") {
			this.error("repeat is only valid inside a screen or define", token);
		} else if (this.looksLikeComponentReference(token.value)) {
			this.error(
				`Components must be inside a screen or define; found "${token.value}" at top level`,
				token,
			);
		} else {
			this.error(`Unknown wireframe keyword "${token.value}"`, token);
		}
		this.skipToEndOfLine();
	}

	private parseTitleLike(field: "title" | "accTitle" | "accDescr"): void {
		// `title: text` or `title text` — accept both, like the other parsers.
		this.consumeIf("identifier", ":");
		const parts: string[] = [];
		while (true) {
			const t = this.peek();
			if (!t || t.type === "newline") break;
			parts.push(t.type === "string" ? `"${t.value}"` : t.value);
			this.consume();
		}
		this.consumeIf("newline");
		const value = parts.join(" ").trim();
		if (!value) {
			this.error(`Expected text after ${field}`, this.peek(-1));
			return;
		}
		this.pendingMeta[field] = value;
	}

	private parseUse(): void {
		this.consume("identifier", "use");
		const moduleToken = this.peek();
		if (moduleToken?.type !== "identifier") {
			this.error("Expected a module name after use", moduleToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const moduleName = moduleToken.value;

		const next = this.peek();
		if (next?.type === "identifier" && next.value === "as") {
			this.consume();
			const aliasToken = this.peek();
			if (aliasToken?.type !== "identifier") {
				this.error("Expected an alias after as", aliasToken ?? next);
				this.skipToEndOfLine();
				return;
			}
			this.consume();
			this.uses.push({
				kind: "namespace",
				module: moduleName,
				alias: aliasToken.value,
			});
			this.expectEndOfLine("use");
			return;
		}

		const names: string[] = [];
		while (true) {
			const token = this.peek();
			if (!token || token.type === "newline") break;
			if (token.type === "identifier") {
				names.push(this.consume().value);
				continue;
			}
			this.error("Expected an imported component name", token);
			this.consume();
		}
		this.consumeIf("newline");

		if (names.length === 0) {
			this.error(
				"use must import a namespace alias (`use @mod as X`) or named components (`use @mod A, B`)",
				moduleToken,
			);
			return;
		}
		this.uses.push({ kind: "named", module: moduleName, names });
	}

	private parseViewportDeclaration(): void {
		const keyword = this.consume("identifier", "viewport");
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier") {
			this.error("Expected a viewport name", nameToken ?? keyword);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const name = nameToken.value;

		let width: number | undefined = WIREFRAME_KNOWN_VIEWPORTS[name];
		while (true) {
			const token = this.peek();
			if (!token || token.type === "newline") break;
			if (token.type === "attribute" && token.value.startsWith("width=")) {
				const parsed = Number.parseInt(token.value.slice("width=".length), 10);
				if (!Number.isFinite(parsed) || parsed <= 0) {
					this.error(`viewport width must be a positive number`, token);
				} else {
					width = parsed;
				}
				this.consume();
				continue;
			}
			this.error(`Unexpected "${token.value}" in viewport declaration`, token);
			this.consume();
		}
		this.consumeIf("newline");

		if (this.viewports.some((v) => v.name === name)) {
			this.error(`Duplicate viewport "${name}"`, nameToken);
			return;
		}
		if (width === undefined) {
			this.error(
				`Unknown viewport "${name}"; give it a width (\`viewport ${name} width=800\`) or use ${Object.keys(WIREFRAME_KNOWN_VIEWPORTS).join(", ")}`,
				nameToken,
			);
			return;
		}
		this.viewports.push({ name, width });
	}

	private parseDefine(): void {
		this.consume("identifier", "define");
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier") {
			this.error("Expected a component name after define", nameToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const name = nameToken.value;
		if (!this.looksLikeComponentReference(name) || name.includes(".")) {
			this.error(`define names must be PascalCase, got "${name}"`, nameToken);
		}
		this.expectEndOfLine("define");

		const holderId = `define-${name}`;
		const holder: WireframeElementNode = {
			id: holderId,
			type: "component",
			nodeKind: "component",
			componentName: name,
			attributes: {},
			flags: [],
			children: [],
		};
		this.elements[holderId] = holder;
		this.parseBlock(holderId, { kind: "define" });

		const template = holder.children ?? [];
		const params = new Set<string>();
		const hooks = new Set<string>();
		this.walk(template, (node) => {
			if (node.content?.startsWith("$")) params.add(node.content.slice(1));
			if (node.targetKind === "call" && node.target) hooks.add(node.target);
		});

		if (this.defines[name]) {
			this.error(`Duplicate define "${name}"`, nameToken);
		}
		this.defines[name] = {
			name,
			params: Array.from(params),
			hooks: Array.from(hooks),
			template,
		};
		delete this.elements[holderId];
	}

	private parseScreen(): void {
		this.consume("identifier", "screen");
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier") {
			this.error("Expected a screen name", nameToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const screenName = nameToken.value;

		// Guide authors off the previous grammar.
		while (true) {
			const t = this.peek();
			if (!t || t.type === "newline") break;
			if (t.type === "bracket") {
				this.error(
					`Screen states are declared inside the screen with \`state ${t.value.slice(1, -1)} … end\`, not with a bracket on the screen line`,
					t,
				);
			} else if (
				t.type === "identifier" &&
				WIREFRAME_KNOWN_VIEWPORTS[t.value]
			) {
				this.error(
					`Viewports are declared at the top level with \`viewport ${t.value}\`, not on the screen line`,
					t,
				);
			} else {
				this.error(`Unexpected "${t.value}" after screen name`, t);
			}
			this.consume();
		}
		this.consumeIf("newline");

		const id = this.generateId("screen", screenName);
		const node: WireframeElementNode = {
			id,
			type: "screen",
			nodeKind: "screen",
			screenName,
			attributes: {},
			flags: [],
			children: [],
			states: [],
			viewportOverrides: [],
		};
		this.elements[id] = node;
		this.link("root", id);
		this.parseBlock(id, { kind: "screen", screenId: id });
	}

	// ─── Blocks ────────────────────────────────────────────────────────────────

	/** Parse statements until `end`. Indentation is presentational. */
	private parseBlock(parentId: string, ctx: BlockContext): void {
		while (true) {
			this.skipTrivia();
			const token = this.peek();
			if (!token) {
				this.error("Missing end", this.peek(-1));
				break;
			}
			if (token.type === "identifier" && token.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			}
			this.parseStatement(parentId, ctx);
		}
	}

	private parseStatement(parentId: string, ctx: BlockContext): void {
		const token = this.peek();
		if (!token) return;
		if (token.type !== "identifier") {
			this.error(`Unexpected ${token.type} "${token.value}"`, token);
			this.skipToEndOfLine();
			return;
		}
		const word = token.value;

		switch (word) {
			case "use":
			case "define":
			case "screen":
			case "viewport":
				if (word === "viewport" && ctx.kind === "screen") {
					this.parseViewportBlock(ctx.screenId);
					return;
				}
				this.error(
					word === "viewport"
						? "viewport blocks are only valid directly inside a screen"
						: `${word} is only valid at the top level`,
					token,
				);
				this.skipToEndOfLine();
				return;
			case "state":
				if (ctx.kind === "screen") {
					this.parseStateBlock(ctx.screenId);
					return;
				}
				this.error(
					"state blocks are only valid directly inside a screen",
					token,
				);
				this.skipToEndOfLine();
				return;
			case "repeat":
				if (ctx.kind === "viewport") {
					this.errorViewportTreeChange(token);
					return;
				}
				this.parseWrapper("repeat", parentId, ctx);
				return;
			case "modal":
				if (ctx.kind === "viewport") {
					this.errorViewportTreeChange(token);
					return;
				}
				if (ctx.kind === "define") {
					this.error("modal is only valid inside a screen", token);
					this.skipToEndOfLine();
					return;
				}
				this.parseWrapper("modal", parentId, ctx);
				return;
		}

		if (WIREFLOW_ONLY_KEYWORDS.has(word)) {
			this.error(`"${word}" belongs to wireflow, not wireframe`, token);
			this.skipToEndOfLine();
			return;
		}
		if (LEGACY_KEYWORDS.has(word)) {
			this.error(
				`"${word}" is legacy wireframe syntax; use components plus repeat/modal instead`,
				token,
			);
			this.skipToEndOfLine();
			return;
		}

		if (this.looksLikeComponentReference(word)) {
			if (ctx.kind === "viewport") {
				this.errorViewportTreeChange(token);
				return;
			}
			this.parseComponent(parentId, ctx);
			return;
		}

		if (this.looksLikeId(word)) {
			if (ctx.kind === "state" || ctx.kind === "viewport") {
				this.parseOverride(ctx);
				return;
			}
			this.error(
				`"${word}" looks like a component id; overrides are only valid inside state and viewport blocks. Components are PascalCase.`,
				token,
			);
			this.skipToEndOfLine();
			return;
		}

		this.error(`Unknown wireframe keyword "${word}"`, token);
		this.skipToEndOfLine();
	}

	private errorViewportTreeChange(token: Token): void {
		this.error(
			"viewport blocks may only override layout props on existing ids; the component tree does not vary per viewport",
			token,
		);
		this.skipToEndOfLine();
		if (this.hasIndentedBlockAhead()) this.skipIndentedBlock();
	}

	private parseComponent(parentId: string, ctx: BlockContext): void {
		const nameToken = this.consume("identifier");
		const componentName = nameToken.value;
		const props = this.parseProperties();
		const node = this.makeNode("component", componentName, props, nameToken);
		this.link(parentId, node.id);
		this.recordInteraction(node, props, ctx);

		if (this.hasIndentedBlockAhead()) {
			this.parseBlock(node.id, this.childContext(ctx));
		}
	}

	/** `repeat` and `modal` wrap children. `repeat Card props` is shorthand for
	 * a block whose only child is a bare `Card`; both forms normalize to the
	 * same AST. */
	private parseWrapper(
		kind: "repeat" | "modal",
		parentId: string,
		ctx: BlockContext,
	): void {
		const keyword = this.consume("identifier", kind);
		let childName: Token | undefined;
		const next = this.peek();
		if (
			next?.type === "identifier" &&
			this.looksLikeComponentReference(next.value)
		) {
			childName = this.consume();
		}
		const props = this.parseProperties();
		if (props.content !== undefined) {
			this.error(
				`${kind} does not take content; put it on a child component`,
				keyword,
			);
		}
		const node = this.makeNode(kind, undefined, props, keyword);
		this.link(parentId, node.id);
		this.recordInteraction(node, props, ctx);

		const hasBody = this.hasIndentedBlockAhead();
		if (childName && hasBody) {
			this.error(
				`${kind} ${childName.value} is shorthand for a single child; drop the name to give ${kind} a body`,
				childName,
			);
			this.skipIndentedBlock();
			return;
		}
		if (childName) {
			const child = this.makeNode(
				"component",
				childName.value,
				{ attributes: {}, flags: [], clearFlags: [] },
				childName,
			);
			this.link(node.id, child.id);
			return;
		}
		if (hasBody) {
			this.parseBlock(node.id, this.childContext(ctx));
			return;
		}
		this.error(
			`${kind} needs a component: \`${kind} Card\` or a body closed by end`,
			keyword,
		);
	}

	private childContext(ctx: BlockContext): BlockContext {
		switch (ctx.kind) {
			case "screen":
				return { kind: "container", screenId: ctx.screenId };
			case "state":
				return { kind: "container", screenId: ctx.screenId };
			case "define":
				return { kind: "define" };
			case "container":
				return ctx;
			case "viewport":
				return ctx;
		}
	}

	private parseStateBlock(screenId: string): void {
		this.consume("identifier", "state");
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier") {
			this.error("Expected a state name", nameToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const name = nameToken.value;
		this.expectEndOfLine("state");

		const screen = this.elements[screenId];
		if (!screen) return;
		screen.states = screen.states ?? [];

		if (name === WIREFRAME_DEFAULT_STATE) {
			this.error(
				`"${WIREFRAME_DEFAULT_STATE}" is the implicit base state and cannot be declared`,
				nameToken,
			);
		} else if (screen.states.some((s) => s.name === name)) {
			this.error(
				`Duplicate state "${name}" in screen ${screen.screenName}`,
				nameToken,
			);
		} else if (this.looksLikeComponentReference(name)) {
			this.error(`State names are lowercase, got "${name}"`, nameToken);
		}

		const state: WireframeScreenState = { name, overrides: [], children: [] };
		screen.states.push(state);

		// Additions parse into a holder so they're not part of the default tree.
		const holderId = `${screenId}__state_${name}`;
		const holder: WireframeElementNode = {
			id: holderId,
			type: "state",
			nodeKind: "component",
			attributes: {},
			flags: [],
			children: [],
		};
		this.elements[holderId] = holder;
		this.parseBlock(holderId, { kind: "state", screenId, state });
		state.children = holder.children ?? [];
		for (const childId of state.children) this.parents[childId] = screenId;
		delete this.elements[holderId];
	}

	private parseViewportBlock(screenId: string): void {
		this.consume("identifier", "viewport");
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier") {
			this.error("Expected a viewport name", nameToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const name = nameToken.value;
		this.expectEndOfLine("viewport");

		const screen = this.elements[screenId];
		if (!screen) return;
		screen.viewportOverrides = screen.viewportOverrides ?? [];

		if (!this.viewports.some((v) => v.name === name)) {
			this.error(
				`Viewport "${name}" is not declared; add \`viewport ${name}\` at the top level`,
				nameToken,
			);
		} else if (screen.viewportOverrides.some((v) => v.viewport === name)) {
			this.error(
				`Duplicate viewport block "${name}" in screen ${screen.screenName}`,
				nameToken,
			);
		}

		const block: WireframeViewportOverrides = { viewport: name, overrides: [] };
		screen.viewportOverrides.push(block);
		const holderId = `${screenId}__viewport_${name}`;
		this.elements[holderId] = {
			id: holderId,
			type: "viewport",
			nodeKind: "component",
			attributes: {},
			flags: [],
			children: [],
		};
		this.parseBlock(holderId, {
			kind: "viewport",
			screenId,
			overrides: block.overrides,
		});
		delete this.elements[holderId];
	}

	private parseOverride(
		ctx:
			| { kind: "state"; screenId: string; state: WireframeScreenState }
			| { kind: "viewport"; screenId: string; overrides: WireframeOverride[] },
	): void {
		const idToken = this.consume("identifier");
		const props = this.parseProperties();
		const override: WireframeOverride = {
			id: idToken.value,
			attributes: props.attributes,
			flags: props.flags,
			clearFlags: props.clearFlags,
		};
		if (props.content !== undefined) override.content = props.content;
		if (props.data !== undefined) override.data = props.data;
		if (props.targetKind) {
			override.targetKind = props.targetKind;
			override.target = props.target;
			if (props.targetKind === "state" && props.target) {
				this.stateTargets.push({
					screenId: ctx.screenId,
					target: props.target,
					token: props.targetToken,
				});
			}
		}
		if (props.attributes.id !== undefined) {
			this.error("An override cannot change a component's id", idToken);
			delete props.attributes.id;
		}
		if (
			ctx.kind === "viewport" &&
			(props.content !== undefined || props.targetKind)
		) {
			this.error(
				"viewport overrides may only change layout props and flags, not content or interactions",
				idToken,
			);
		}

		if (this.hasIndentedBlockAhead()) {
			this.error(
				"Overrides cannot have children; they change props on an existing id",
				idToken,
			);
			this.skipIndentedBlock();
		}

		if (ctx.kind === "state") {
			ctx.state.overrides.push(override);
			this.overrideTokens.push({
				screenId: ctx.screenId,
				override,
				state: ctx.state,
				token: idToken,
			});
		} else {
			ctx.overrides.push(override);
			this.overrideTokens.push({
				screenId: ctx.screenId,
				override,
				token: idToken,
			});
		}
	}

	// ─── Statement tails ───────────────────────────────────────────────────────

	/** Parse everything after a statement's head up to end of line:
	 * optional content (`"text"` or `$param`), `key=value` attributes, bare
	 * flags, `-flag` clears, and one `-->|kind| target` interaction. */
	private parseProperties(): ParsedProperties {
		const props: ParsedProperties = {
			attributes: {},
			flags: [],
			clearFlags: [],
		};

		const first = this.peek();
		if (first?.type === "string") {
			props.content = this.consume().value;
		} else if (first?.type === "identifier" && first.value.startsWith("$")) {
			props.content = this.consume().value;
		}

		while (true) {
			const token = this.peek();
			if (!token || token.type === "newline") break;

			if (token.type === "attribute") {
				const eq = token.value.indexOf("=");
				const key = token.value.slice(0, eq);
				const value = token.value.slice(eq + 1);
				if (key === "data") {
					props.data = value;
				} else {
					if (props.attributes[key] !== undefined) {
						this.error(`Duplicate attribute "${key}"`, token);
					}
					props.attributes[key] = value;
				}
				this.consume();
				continue;
			}

			if (token.type === "string") {
				this.error(
					props.content !== undefined
						? "Only one content string per component"
						: "Content must come directly after the component name",
					token,
				);
				this.consume();
				continue;
			}

			if (token.type === "identifier") {
				if (token.value === "-") {
					this.consume();
					const flag = this.peek();
					if (flag?.type === "identifier" && flag.value !== "-") {
						props.clearFlags.push(this.consume().value);
					} else {
						this.error("Expected a flag name after -", flag ?? token);
					}
					continue;
				}
				if (token.value === "id") {
					this.error(
						"Bare `id` is no longer supported; write `id=name`",
						token,
					);
					this.consume();
					continue;
				}
				if (KEYWORDS.has(token.value)) {
					this.error(
						`"${token.value}" is a keyword and cannot be a flag`,
						token,
					);
					this.consume();
					continue;
				}
				props.flags.push(this.consume().value);
				continue;
			}

			if (token.type === "hook") {
				this.error(
					"Raw @hook references are legacy wireframe syntax; use `-->|call| hookName`",
					token,
				);
				this.consume();
				continue;
			}

			if (token.type === "labeled-arrow") {
				const arrow = this.consume();
				const kind = extractLabel(arrow.value);
				if (!isInteractionKind(kind)) {
					this.error(
						`Expected goto, state, or call inside the arrow label, got "${kind}"`,
						arrow,
					);
					this.consumeIf("identifier");
					continue;
				}
				if (props.targetKind) {
					this.error("Only one interaction per component", arrow);
				}
				const targetToken = this.peek();
				if (targetToken?.type === "identifier") {
					this.consume();
					props.targetKind = kind;
					props.target = targetToken.value;
					props.targetToken = targetToken;
				} else {
					this.error(
						`Expected a target after -->|${kind}|`,
						targetToken ?? arrow,
					);
				}
				continue;
			}

			if (token.type === "arrow") {
				this.error(
					"Interactions need a kind: `-->|goto| Screen`, `-->|state| name`, or `-->|call| hook`",
					token,
				);
				this.consume();
				const t = this.peek();
				if (t?.type === "identifier" || t?.type === "hook") this.consume();
				continue;
			}

			if (token.type === "bracket") {
				this.error(`Unexpected ${token.value}`, token);
				this.consume();
				continue;
			}

			this.error(`Unexpected ${token.type} "${token.value}"`, token);
			this.consume();
		}

		this.consumeIf("newline");
		return props;
	}

	private makeNode(
		nodeKind: "component" | "repeat" | "modal",
		componentName: string | undefined,
		props: ParsedProperties,
		token: Token,
	): WireframeElementNode {
		const declaredId = props.attributes.id;
		delete props.attributes.id;
		const stem = componentName ? this.unqualified(componentName) : nodeKind;
		// Ids are scoped to a screen, so two screens may both declare `id=nav`.
		// The elements map is global; keep its key unique while `declaredId`
		// carries what the author wrote.
		const id =
			declaredId !== undefined
				? this.uniqueKey(declaredId)
				: this.generateId(nodeKind, stem);

		const node: WireframeElementNode = {
			id,
			type: nodeKind,
			nodeKind,
			attributes: props.attributes,
			flags: props.flags,
			children: [],
		};
		if (declaredId !== undefined) {
			node.declaredId = declaredId;
			if (!this.looksLikeId(declaredId)) {
				this.error(
					`ids are lowercase identifiers (camelCase), got "${declaredId}"`,
					token,
				);
			}
			this.idTokens[id] = token;
		}
		if (componentName !== undefined) {
			node.componentName = componentName;
			this.componentTokens[id] = token;
		}
		if (props.content !== undefined) node.content = props.content;
		if (props.data !== undefined) node.data = props.data;
		if (props.targetKind) {
			node.targetKind = props.targetKind;
			node.target = props.target;
		}
		if (props.clearFlags.length > 0) {
			this.error("`-flag` is only meaningful in an override", token);
		}

		if (componentName === "Stack") this.checkStackProps(node, token);
		this.checkSizingProps(node, token);

		this.elements[id] = node;
		return node;
	}

	private uniqueKey(declaredId: string): string {
		if (!this.elements[declaredId]) return declaredId;
		let n = 2;
		while (this.elements[`${declaredId}~${n}`]) n++;
		return `${declaredId}~${n}`;
	}

	private checkStackProps(node: WireframeElementNode, token: Token): void {
		const { direction, align, justify } = node.attributes;
		if (direction !== undefined && !STACK_DIRECTIONS.has(direction)) {
			this.error(
				`Stack direction must be row or column, got "${direction}"`,
				token,
			);
		}
		if (align !== undefined && !STACK_ALIGNS.has(align)) {
			this.error(
				`Stack align must be start, center, end, or stretch, got "${align}"`,
				token,
			);
		}
		if (justify !== undefined && !STACK_JUSTIFIES.has(justify)) {
			this.error(
				`Stack justify must be start, center, end, or between, got "${justify}"`,
				token,
			);
		}
		for (const key of ["gap", "padding"] as const) {
			const value = node.attributes[key];
			if (
				value !== undefined &&
				!SPACING_WORDS.has(value) &&
				!/^\d+$/.test(value)
			) {
				this.error(
					`Stack ${key} must be a number or one of ${[...SPACING_WORDS].join(", ")}, got "${value}"`,
					token,
				);
			}
		}
	}

	private checkSizingProps(node: WireframeElementNode, token: Token): void {
		for (const key of ["width", "height"] as const) {
			const value = node.attributes[key];
			if (
				value !== undefined &&
				!SIZING_WORDS.has(value) &&
				!/^\d+$/.test(value)
			) {
				this.error(
					`${key} must be fill, hug, or a number, got "${value}"`,
					token,
				);
			}
		}
	}

	private recordInteraction(
		node: WireframeElementNode,
		props: ParsedProperties,
		ctx: BlockContext,
	): void {
		if (node.targetKind !== "state" || !node.target) return;
		const screenId = ctx.kind === "define" ? undefined : ctx.screenId;
		if (!screenId) return;
		this.stateTargets.push({
			screenId,
			target: node.target,
			token: props.targetToken,
		});
	}

	// ─── Validation ────────────────────────────────────────────────────────────

	private validate(ast: WireframeAST): void {
		if (this.pendingMeta.title) ast.title = this.pendingMeta.title;
		if (this.pendingMeta.accTitle) ast.accTitle = this.pendingMeta.accTitle;
		if (this.pendingMeta.accDescr) ast.accDescr = this.pendingMeta.accDescr;

		const namespaceImports = new Map<string, string>();
		const namedImports = new Map<string, string>();
		for (const use of ast.uses) {
			if (use.kind === "namespace") {
				if (namespaceImports.has(use.alias)) {
					this.error(
						`Duplicate namespace import alias "${use.alias}"`,
						this.findIdentifier(use.alias),
					);
				}
				namespaceImports.set(use.alias, use.module);
				continue;
			}
			for (const name of use.names) {
				if (namedImports.has(name)) {
					this.error(
						`Duplicate named import "${name}"`,
						this.findIdentifier(name),
					);
				}
				namedImports.set(name, use.module);
			}
		}

		for (const node of Object.values(ast.elements)) {
			if (node.nodeKind !== "component" || !node.componentName) continue;
			const resolved = this.resolveComponent(
				node,
				namespaceImports,
				namedImports,
			);
			if (resolved) node.component = resolved;
		}

		const root = ast.elements[ast.root];
		for (const screenId of root?.children ?? []) {
			const screen = ast.elements[screenId];
			if (screen?.nodeKind !== "screen") continue;
			this.validateScreen(screen, ast);
		}

		// Interaction `state` targets must name a declared state or `default`.
		for (const { screenId, target, token } of this.stateTargets) {
			const screen = ast.elements[screenId];
			if (!screen) continue;
			const known =
				target === WIREFRAME_DEFAULT_STATE ||
				(screen.states ?? []).some((s) => s.name === target);
			if (!known) {
				this.error(
					`Unknown state "${target}" in screen ${screen.screenName}; declare it with \`state ${target} … end\``,
					token,
				);
			}
		}
	}

	private validateScreen(
		screen: WireframeElementNode,
		ast: WireframeAST,
	): void {
		const hooks = new Set<string>();
		const defaultIds = new Map<string, WireframeElementNode>();
		const seen = new Set<string>();

		const visit = (
			node: WireframeElementNode,
			into: Map<string, WireframeElementNode>,
		) => {
			if (node.targetKind === "call" && node.target) hooks.add(node.target);
			if (node.component?.kind === "local") {
				for (const hook of ast.defines[node.component.name]?.hooks ?? [])
					hooks.add(hook);
			}
			if (node.declaredId) {
				if (seen.has(node.declaredId)) {
					this.error(
						`Duplicate id "${node.declaredId}" in screen ${screen.screenName}`,
						this.idTokens[node.id],
					);
				}
				seen.add(node.declaredId);
				into.set(node.declaredId, node);
			}
		};

		this.walk(screen.children ?? [], (node) => visit(node, defaultIds));

		for (const state of screen.states ?? []) {
			const stateIds = new Map<string, WireframeElementNode>();
			this.walk(state.children, (node) => visit(node, stateIds));
			for (const override of state.overrides) {
				const target = defaultIds.get(override.id) ?? stateIds.get(override.id);
				if (!target) {
					this.error(
						`Override "${override.id}" in state ${state.name} does not match any id in screen ${screen.screenName}`,
						this.findOverrideToken(override),
					);
				}
			}
		}

		for (const block of screen.viewportOverrides ?? []) {
			for (const override of block.overrides) {
				if (!defaultIds.has(override.id)) {
					this.error(
						`Override "${override.id}" in viewport ${block.viewport} does not match any id in screen ${screen.screenName}`,
						this.findOverrideToken(override),
					);
				}
			}
		}

		screen.hooks = Array.from(hooks);
	}

	private resolveComponent(
		node: WireframeElementNode,
		namespaceImports: Map<string, string>,
		namedImports: Map<string, string>,
	): WireframeComponentRef | undefined {
		const raw = node.componentName ?? "";
		const token = this.componentTokens[node.id];

		if (raw.includes(".")) {
			const dot = raw.indexOf(".");
			const alias = raw.slice(0, dot);
			const name = raw.slice(dot + 1);
			const moduleName = namespaceImports.get(alias);
			if (!moduleName) {
				this.error(
					`Unknown namespace "${alias}" in "${raw}"; import it with \`use @module as ${alias}\``,
					token,
				);
				return undefined;
			}
			if (!name || !this.looksLikeComponentReference(name)) {
				this.error(
					`Expected a PascalCase component after "${alias}." in "${raw}"`,
					token,
				);
				return undefined;
			}
			return { kind: "namespace-import", module: moduleName, alias, name };
		}

		if (this.defines[raw]) return { kind: "local", name: raw };
		const moduleName = namedImports.get(raw);
		if (moduleName)
			return { kind: "named-import", module: moduleName, name: raw };

		if (WIREFRAME_UI_COMPONENTS[raw]) {
			this.error(
				`"${raw}" is not imported; add \`use ${WIREFRAME_UI_MODULE} ${raw}\``,
				token,
			);
		} else {
			this.error(
				`Unresolved component "${raw}"; import it, define it, or qualify it with a namespace`,
				token,
			);
		}
		return undefined;
	}

	// ─── Helpers ───────────────────────────────────────────────────────────────

	private walk(
		ids: string[],
		visit: (node: WireframeElementNode) => void,
	): void {
		for (const id of ids) {
			const node = this.elements[id];
			if (!node) continue;
			visit(node);
			if (node.children) this.walk(node.children, visit);
		}
	}

	private link(parentId: string, childId: string): void {
		const parent = this.elements[parentId];
		if (!parent) return;
		parent.children = parent.children ?? [];
		parent.children.push(childId);
		this.parents[childId] = parentId;
	}

	private expectEndOfLine(construct: string): void {
		const token = this.peek();
		if (token && token.type !== "newline") {
			this.error(`Unexpected "${token.value}" after ${construct}`, token);
			this.skipToEndOfLine();
			return;
		}
		this.consumeIf("newline");
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

	/** Skip a block we've already reported as invalid, through its `end`. */
	private skipIndentedBlock(): void {
		let depth = 0;
		while (true) {
			const current = this.peek();
			if (!current) return;
			this.pos++;
			if (current.type === "indent") {
				depth++;
				continue;
			}
			if (current.type === "dedent") {
				depth--;
				if (depth <= 0) break;
			}
		}
		this.skipTrivia();
		if (this.peek()?.type === "identifier" && this.peek()?.value === "end") {
			this.consume();
			this.consumeIf("newline");
		}
	}

	private findIdentifier(value: string): Token | undefined {
		return this.tokens.find(
			(t) => t.type === "identifier" && t.value === value,
		);
	}

	private findOverrideToken(override: WireframeOverride): Token | undefined {
		return this.overrideTokens.find((o) => o.override === override)?.token;
	}

	private looksLikeComponentReference(value: string): boolean {
		if (value.includes(".")) {
			const [alias, ...rest] = value.split(".");
			return /^[A-Z][A-Za-z0-9_]*$/.test(alias ?? "") && rest.length > 0;
		}
		return /^[A-Z][A-Za-z0-9_]*$/.test(value);
	}

	private looksLikeId(value: string): boolean {
		return /^[a-z_][A-Za-z0-9_]*$/.test(value) && !KEYWORDS.has(value);
	}

	private unqualified(value: string): string {
		const parts = value.split(".");
		return parts[parts.length - 1] || value;
	}

	private generateId(type: string, seed?: string): string {
		const stem = seed
			? seed
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "")
			: type;
		const base = `${type}-${stem}`;
		this.idCounters[base] = (this.idCounters[base] ?? 0) + 1;
		return `${base}-${this.idCounters[base] - 1}`;
	}
}

/** Extract the inner label of a labeled-arrow token value: `-->|goto|` → `goto`. */
export function extractLabel(arrowValue: string): string {
	const first = arrowValue.indexOf("|");
	const last = arrowValue.lastIndexOf("|");
	if (first === -1 || first === last) return "";
	let label = arrowValue.slice(first + 1, last);
	if (label.startsWith('"') && label.endsWith('"')) {
		label = label.slice(1, -1);
	}
	return label.trim();
}

export function isInteractionKind(
	value: string,
): value is WireframeInteractionKind {
	return value === "goto" || value === "state" || value === "call";
}
