import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult, Token } from "../../types.ts";
import {
	UI_DATA_ATTRIBUTES,
	UI_IO_MODES,
	UI_STANDARD_ELEMENTS,
	UI_STANDARD_MODULE,
	UI_UNIVERSAL_EVENT,
	UI_UNIVERSAL_FLAGS,
	type UiAction,
	type UiApi,
	type UiAST,
	type UiCase,
	type UiComponent,
	type UiCondition,
	type UiHandler,
	type UiImport,
	type UiIo,
	type UiIoMode,
	type UiMode,
	type UiNode,
	type UiOverride,
	type UiTheme,
} from "./uiTypes.ts";

export const KEYWORDS = new Set([
	"ui",
	"use",
	"api",
	"in",
	"out",
	"screen",
	"component",
	"layout",
	"list",
	"as",
	"modal",
	"when",
	"else",
	"end",
	"go",
	"title",
	"accTitle",
	"accDescr",
	...UI_IO_MODES,
]);

/** Words from earlier drafts of the language, with what replaced them. */
const RETIRED: Record<string, string> = {
	state: "modes are declared on the header: `component Name @a @b`",
	entry: "the screen whose route is / is where the app opens",
	repeat: "`list data as item … end`",
	reads: "`in ~name(args)`",
	writes: "`out ~name(args)`",
	read: "`in ~name(args)`",
	write: "`out ~name(args)`",
	load: "`in ~name(args)`",
	send: "`out ~name(args)`",
	emit: "an action: `=> $event(value)`",
	emits: "a handler on the element: `$click => $open(band)`",
	on: "a handler on the element: `$event => action`",
	if: "`when`",
	done: "`ready`",
	failed: "`error`",
	pending: "`loading`",
	initial: "the first mode declared on the header is the start",
};

const IO_MODES = new Set<string>(UI_IO_MODES);

type Phase = "io" | "tree" | "whens";

export class UiParser extends DiagramParser<UiAST> {
	constructor(tokens: Token[]) {
		super(tokens, { semicolons: true });
	}

	private uses: UiImport[] = [];
	private apis: UiApi[] = [];
	private io: UiIo[] = [];
	private components: Record<string, UiComponent> = {};
	private order: string[] = [];
	private meta: { title?: string; accTitle?: string; accDescr?: string } = {};
	private theme?: Partial<UiTheme>;
	private keyCounter = 0;

	private nodeTokens = new Map<UiNode, Token>();
	private caseTokens = new Map<UiCase, Token>();
	private overrideTokens = new Map<UiOverride, Token>();
	private ioTokens = new Map<UiIo, Token>();
	private handlerTokens = new Map<UiHandler, Token>();
	/** Nodes whose line lost a handler to a parse error. What that handler
	 * would have handled is unknown, so no check is built on its absence. */
	private broken = new Set<UiNode>();
	private actionTokens = new Map<UiAction, Token>();
	private componentTokens = new Map<UiComponent, Token>();
	private layoutTokens = new Map<UiComponent, Token>();
	private modeTokens = new Map<UiMode, Token>();

	parse(): ParseResult<UiAST> {
		this.skipTrivia();
		const first = this.peek();
		if (first?.type === "identifier" && first.value.toLowerCase() === "ui") {
			this.consume();
			this.skipToEndOfLine();
		}

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const token = this.peek();
			if (!token) break;
			if (token.type === "identifier" && token.value === "end") {
				this.consume();
				this.consumeIf("newline");
				if (token.indentLevel > 0 && !this.isAtEnd()) {
					// The document's own end is at the margin; an indented one
					// here is left over from a block above it.
					this.error(`Extra end on line ${token.line}`, token);
					continue;
				}
				break;
			}
			this.parseTopLevel();
		}

		const ast: UiAST = {
			type: "ui",
			uses: this.uses,
			apis: this.apis,
			io: this.io,
			components: this.components,
			order: this.order,
		};
		if (this.theme) ast.theme = this.theme;
		if (this.meta.title) ast.title = this.meta.title;
		if (this.meta.accTitle) ast.accTitle = this.meta.accTitle;
		if (this.meta.accDescr) ast.accDescr = this.meta.accDescr;

		this.finish(ast);
		return this.result(ast);
	}

	// ─── Top level ─────────────────────────────────────────────────────────────

	private parseTopLevel(): void {
		const token = this.peek();
		if (!token) return;
		if (token.type === "directive") {
			this.consume();
			this.parseDirective(token);
			this.endStatement();
			return;
		}
		if (token.type !== "identifier") {
			this.error(
				`Unexpected ${token.type} "${token.value}" at top level`,
				token,
			);
			this.skipToEndOfLine();
			return;
		}
		switch (token.value) {
			case "use":
				this.parseUse();
				return;
			case "api":
				this.parseApi();
				return;
			case "in":
			case "out":
				if (token.value === "out")
					this.error("Document-level io is `in` only: app data", token);
				this.parseIo(this.io);
				return;
			case "screen":
				this.parseComponentDecl("screen");
				return;
			case "component":
				this.parseComponentDecl("component");
				return;
			case "layout":
				this.parseComponentDecl("layout");
				return;
			case "title":
			case "accTitle":
			case "accDescr":
				this.consume();
				this.parseMeta(token.value as "title" | "accTitle" | "accDescr");
				return;
		}
		if (isPascal(token.value)) {
			this.error(
				`"${token.value}" must be inside a screen, layout, or component`,
				token,
			);
		} else if (RETIRED[token.value]) {
			this.error(
				`"${token.value}" is not a keyword; ${RETIRED[token.value]}`,
				token,
			);
		} else {
			this.error(`Unknown keyword "${token.value}"`, token);
		}
		this.skipToEndOfLine();
	}

	/** `%%{theme ink=#002676 accent=#FDB515}%%`: the directive name, then
	 * key=value pairs in the language's own form. */
	private parseDirective(token: Token): void {
		const inner = token.value.replace(/^%%\{/, "").replace(/\}%%$/, "").trim();
		const [name, ...pairs] = inner.split(/\s+/).filter(Boolean);
		if (name !== "theme") {
			this.error(
				`Unknown directive "${name ?? ""}"; the ui diagram takes \`%%{theme ink=… accent=…}%%\``,
				token,
			);
			return;
		}
		const theme: Partial<UiTheme> = { ...this.theme };
		for (const pair of pairs) {
			const eq = pair.indexOf("=");
			const key = eq === -1 ? pair : pair.slice(0, eq);
			const value = eq === -1 ? "" : pair.slice(eq + 1);
			if (key !== "ink" && key !== "accent") {
				this.error(
					`theme has no setting "${key}"; it takes ink and accent`,
					token,
				);
				continue;
			}
			if (!/^#[0-9A-Fa-f]{3,8}$/.test(value)) {
				this.error(`theme ${key} is a hex color, got "${value}"`, token);
				continue;
			}
			theme[key] = value;
		}
		this.theme = theme;
	}

	private parseMeta(field: "title" | "accTitle" | "accDescr"): void {
		this.consumeIf("identifier", ":");
		const parts: string[] = [];
		while (!this.atStatementEnd()) {
			const t = this.consume();
			parts.push(t.type === "string" ? `"${t.value}"` : t.value);
		}
		this.endStatement();
		const value = parts.join(" ").trim();
		if (value) this.meta[field] = value;
	}

	/** `use "<module>" A, B` or `use "<module>" as X`. The module is a
	 * quoted string; a bare path is accepted too. */
	private parseModule(keyword: Token): string | undefined {
		const t = this.peek();
		if (t?.type === "string" || t?.type === "identifier") {
			this.consume();
			return t.value;
		}
		this.error(`Expected a module after ${keyword.value}: "@scope/name"`, t);
		this.skipToEndOfLine();
		return undefined;
	}

	private parseUse(): void {
		const keyword = this.consume("identifier", "use");
		const module = this.parseModule(keyword);
		if (module === undefined) return;
		const next = this.peek();
		if (next?.type === "identifier" && next.value === "as") {
			this.consume();
			const alias = this.peek();
			if (alias?.type !== "identifier" || !isPascal(alias.value)) {
				this.error("Expected a PascalCase alias after as", alias ?? next);
				this.skipToEndOfLine();
				return;
			}
			this.consume();
			this.uses.push({ kind: "namespace", module, alias: alias.value });
			this.endStatement();
			return;
		}
		const names: string[] = [];
		while (!this.atStatementEnd()) {
			const t = this.consume();
			if (t.type === "identifier" && isPascal(t.value)) names.push(t.value);
			else
				this.error(
					`Expected an element or component name, got "${t.value}"`,
					t,
				);
		}
		this.endStatement();
		if (names.length === 0) {
			this.error(
				'use imports names (`use "@mod" A, B`) or a namespace (`use "@mod" as X`)',
				keyword,
			);
			return;
		}
		this.uses.push({ kind: "named", module, names });
	}

	/** `api "<module>" name, …`: operations by name, or none when the
	 * module is a formal source. */
	private parseApi(): void {
		const keyword = this.consume("identifier", "api");
		const module = this.parseModule(keyword);
		if (module === undefined) return;
		const names: string[] = [];
		while (!this.atStatementEnd()) {
			const t = this.consume();
			if (t.type === "identifier" && isLower(t.value)) names.push(t.value);
			else if (t.type === "tilde")
				this.error(
					`Operations are listed bare in api: ${t.value}; the sigil goes where one is used`,
					t,
				);
			else this.error(`Expected an operation name, got "${t.value}"`, t);
		}
		this.endStatement();
		this.apis.push({ module, names });
	}

	private parseComponentDecl(kind: "screen" | "component" | "layout"): void {
		const isScreen = kind === "screen";
		const keyword = this.consume();
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier" || !isPascal(nameToken.value)) {
			this.error(
				`Expected a PascalCase name after ${keyword.value}`,
				nameToken ?? keyword,
			);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const component: UiComponent = {
			name: nameToken.value,
			routeParams: [],
			layoutArgs: {},
			params: [],
			modes: [],
			io: [],
			tree: [],
			whens: [],
			emits: {},
			scope: [],
		};
		if (kind === "layout") component.isLayout = true;
		this.componentTokens.set(component, nameToken);

		const params = this.peek();
		if (params?.type === "bracket" && params.value.startsWith("(")) {
			this.consume();
			component.params = splitList(params.value.slice(1, -1));
			for (const param of component.params) {
				if (!isLower(param))
					this.error(`Parameters are lowercase names, got "${param}"`, params);
			}
			if (isScreen)
				this.error("Screens take route params, not parameters", params);
		}

		while (!this.atStatementEnd() && this.peek()?.value !== "{") {
			const t = this.consume();
			if (t.type === "attribute" && t.value.startsWith("route=")) {
				if (!isScreen) this.error("Only screens have a route", t);
				component.route = t.value.slice("route=".length);
				component.routeParams = [
					...component.route.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g),
				].map((m) => m[1] ?? "");
				continue;
			}
			if (t.type === "attribute" && t.value.startsWith("layout=")) {
				if (!isScreen) this.error("Only screens name a layout", t);
				const call = parseCall(t.value.slice("layout=".length));
				if (!call) {
					this.error(
						"layout= names a layout, with arguments in parens: `layout=AppShell(current=Search)`",
						t,
					);
					continue;
				}
				component.layoutName = call.name;
				component.layoutArgs = this.argList(call.args, t);
				this.layoutTokens.set(component, t);
				continue;
			}
			if (t.type === "hook") {
				const mode: UiMode = { name: t.value.slice(1) };
				if (!isLower(mode.name))
					this.error(`Mode names are lowercase: @${mode.name}`, t);
				const param = this.peek();
				if (param?.type === "bracket" && param.value.startsWith("(")) {
					this.consume();
					const names = splitList(param.value.slice(1, -1));
					if (names.length !== 1 || !isLower(names[0] ?? ""))
						this.error(
							`A mode takes at most one parameter: @${mode.name}(name)`,
							param,
						);
					else mode.param = names[0];
				}
				if (component.modes.some((m) => m.name === mode.name))
					this.error(`Duplicate mode @${mode.name}`, t);
				component.modes.push(mode);
				this.modeTokens.set(mode, t);
				continue;
			}
			this.error(`Unexpected "${t.value}" on ${keyword.value} line`, t);
		}
		if (isScreen && component.route === undefined) {
			this.error(
				`screen ${component.name} needs a route: \`screen ${component.name} route=/path\``,
				nameToken,
			);
		}

		if (this.components[component.name]) {
			this.error(`Duplicate declaration "${component.name}"`, nameToken);
		}
		this.components[component.name] = component;
		this.order.push(component.name);

		const phase = { current: "io" as Phase };
		this.parseBlock(
			() => this.parseBodyStatement(component, phase),
			keyword,
			`${kind} ${component.name}`,
		);
	}

	// ─── Component body ────────────────────────────────────────────────────────

	/** A body reads top down: io, then the tree, then component-level
	 * `when`. The order is enforced so a reader meets every name before it
	 * is used. */
	private parseBodyStatement(
		component: UiComponent,
		phase: { current: Phase },
	): void {
		const token = this.peek();
		if (!token) return;
		if (token.type === "hash") {
			this.error(
				`An override goes in a component-level when: \`when … => { #${token.value.split(".")[0]} … }\``,
				token,
			);
			this.skipStatement();
			return;
		}
		if (token.type === "hook") {
			this.error(
				`Modes are declared on the header: \`${component.isLayout ? "layout" : component.route !== undefined ? "screen" : "component"} ${component.name} … ${token.value}\``,
				token,
			);
			this.skipStatement();
			return;
		}
		if (token.type === "tilde") {
			this.error(
				`An operation is declared with in or out: \`in ~${token.value}\``,
				token,
			);
			this.skipStatement();
			return;
		}
		if (token.type !== "identifier") {
			this.error(`Unexpected ${token.type} "${token.value}"`, token);
			this.skipStatement();
			return;
		}
		switch (token.value) {
			case "in":
			case "out":
				if (phase.current !== "io")
					this.error(
						`in and out declarations go before the tree in ${component.name}`,
						token,
					);
				this.parseIo(component.io);
				return;
			case "when": {
				const when = this.parseWhen();
				if (!when) return;
				if (when.level === "overrides") {
					phase.current = "whens";
					component.whens.push(when.node);
				} else {
					if (phase.current === "whens")
						this.error(
							"The tree comes before component-level when blocks",
							token,
						);
					else phase.current = "tree";
					component.tree.push(when.node);
				}
				return;
			}
			case "list":
			case "modal":
				break;
			case "use":
			case "api":
			case "screen":
			case "component":
			case "layout":
				this.error(`${token.value} is only valid at the top level`, token);
				this.skipStatement();
				return;
		}
		if (
			token.value === "list" ||
			token.value === "modal" ||
			isPascal(token.value)
		) {
			if (phase.current === "whens")
				this.error("The tree comes before component-level when blocks", token);
			else phase.current = "tree";
			const node = this.parseTreeStatement();
			if (node) component.tree.push(node);
			return;
		}
		if (RETIRED[token.value]) {
			this.error(
				`"${token.value}" is not a keyword; ${RETIRED[token.value]}`,
				token,
			);
			this.skipStatement();
			this.skipBlock();
			return;
		}
		if (isLower(token.value)) {
			this.error(
				`"${token.value}" is a bare name; a line starts with a keyword, a Type, #handle, or @mode`,
				token,
			);
			this.skipStatement();
			return;
		}
		this.error(`Unknown keyword "${token.value}"`, token);
		this.skipStatement();
	}

	// ─── Io ────────────────────────────────────────────────────────────────────

	/** `in ~name(args)` / `out ~name(args)`, with an optional block of
	 * outcome lines, `ready => go Search`. */
	private parseIo(target: UiIo[]): void {
		const keyword = this.consume();
		const kind = keyword.value as "in" | "out";
		const nameToken = this.peek();
		if (nameToken?.type !== "tilde") {
			this.error(
				`${kind} declares an operation by its sigil: \`${kind} ~name\``,
				nameToken ?? keyword,
			);
			this.skipStatement();
			return;
		}
		this.consume();
		if (nameToken.value.includes(".")) {
			this.error(
				`A declaration names the operation alone: ~${nameToken.value.split(".")[0]}`,
				nameToken,
			);
		}
		const io: UiIo = {
			kind,
			name: nameToken.value.split(".")[0] ?? nameToken.value,
			args: {},
			outcomes: [],
		};
		this.ioTokens.set(io, nameToken);
		const args = this.peek();
		if (args?.type === "bracket" && args.value.startsWith("(")) {
			this.consume();
			io.args = this.argList(args.value.slice(1, -1), args);
		}
		while (!this.atStatementEnd() && this.peek()?.value !== "{") {
			const t = this.consume();
			if (t.type === "identifier" && t.value === "idle") {
				this.error(
					"idle is not a word; an in runs on entry and when an argument changes",
					t,
				);
				continue;
			}
			this.error(`Unexpected "${t.value}" after ~${io.name}`, t);
		}
		target.push(io);
		if (this.peek()?.value === "{" || this.indentedBlockAhead()) {
			this.parseBlock(
				() => this.parseOutcome(io),
				keyword,
				`${kind} ~${io.name}`,
			);
			return;
		}
		this.endStatement();
	}

	private parseOutcome(io: UiIo): void {
		const token = this.peek();
		if (!token) return;
		if (token.type !== "identifier" || !IO_MODES.has(token.value)) {
			if (token.type === "hash" || isPascal(token.value)) {
				this.error(
					`An io block holds outcomes only (\`ready => action\`); what ~${io.name} looks like goes in the tree under \`when ~${io.name}.loading\``,
					token,
				);
			} else {
				this.error(
					`Expected an io mode (${UI_IO_MODES.join(", ")}) in ~${io.name}, got "${token.value}"`,
					token,
				);
			}
			this.skipStatement();
			return;
		}
		this.consume();
		const arrow = this.peek();
		if (arrow?.type !== "arrow") {
			this.error(
				`An outcome is \`${token.value} => action\`${arrow?.value === "{" ? "; overrides go in the tree under when" : ""}`,
				arrow ?? token,
			);
			this.skipStatement();
			this.skipBlock();
			return;
		}
		this.consume();
		this.checkArrow(arrow);
		if (this.peek()?.value === "{") {
			this.error(
				`An outcome is \`${token.value} => action\`; what ~${io.name} looks like while ${token.value} goes in the tree under \`when ~${io.name}.${token.value}\``,
				this.peek(),
			);
			this.skipBlock();
			return;
		}
		const action = this.parseAction();
		if (!action) return;
		io.outcomes.push({ mode: token.value as UiIoMode, action });
		this.finishStatement();
	}

	// ─── Tree ──────────────────────────────────────────────────────────────────

	/** One line of a tree and what hangs under it. */
	private parseTreeStatement(): UiNode | undefined {
		const token = this.peek();
		if (!token) return undefined;
		if (token.type === "identifier") {
			if (token.value === "when") {
				const when = this.parseWhen();
				if (!when) return undefined;
				if (when.level === "overrides") {
					this.error(
						"Overrides belong in a component-level when, after the tree",
						token,
					);
					return undefined;
				}
				return when.node;
			}
			if (token.value === "list") return this.parseList();
			if (token.value === "modal") return this.parseModal();
			if (isPascal(token.value)) return this.parseNode();
			if (RETIRED[token.value]) {
				this.error(
					`"${token.value}" is not a keyword; ${RETIRED[token.value]}`,
					token,
				);
			} else if (isLower(token.value)) {
				this.error(
					`"${token.value}" is not an element; a tree line starts with a Type, list, modal, or when`,
					token,
				);
			} else {
				this.error(`Unexpected "${token.value}" in tree`, token);
			}
			this.skipStatement();
			return undefined;
		}
		if (token.type === "hash") {
			this.error(
				`#${token.value} is a reference; an override goes in a component-level when`,
				token,
			);
		} else {
			this.error(`Unexpected ${token.type} "${token.value}" in tree`, token);
		}
		this.skipStatement();
		return undefined;
	}

	private newNode(kind: UiNode["kind"], head: Token): UiNode {
		const node: UiNode = {
			key: `n${this.keyCounter++}`,
			kind,
			words: [],
			pairs: {},
			args: {},
			attributes: {},
			flags: [],
			handlers: [],
			children: [],
		};
		this.nodeTokens.set(node, head);
		return node;
	}

	/** `Type ["content"] [(args)] [#handle] [key=value …] [flag …]
	 * [$event[(param)] => action …]`, then children. */
	private parseNode(): UiNode | undefined {
		const head = this.consume();
		const node = this.newNode("instance", head);
		node.name = head.value;
		const args = this.peek();
		if (args?.type === "bracket" && args.value.startsWith("(")) {
			this.consume();
			node.args = this.argList(args.value.slice(1, -1), args);
		}
		this.parseNodeTail(node);
		this.parseChildren(node);
		return node;
	}

	private parseNodeTail(node: UiNode): void {
		while (!this.atStatementEnd() && this.peek()?.value !== "{") {
			const t = this.peek();
			if (!t) return;
			if (t.type === "identifier" && t.value.startsWith("$")) {
				const handler = this.parseHandler();
				if (handler) node.handlers.push(handler);
				else this.broken.add(node);
				continue;
			}
			this.consume();
			if (t.type === "string") {
				if (node.content !== undefined)
					this.error("One content string per line", t);
				node.content = t.value;
				continue;
			}
			if (t.type === "hash") {
				if (t.value.includes("."))
					this.error(`A handle is declared bare: #${t.value.split(".")[0]}`, t);
				else if (node.id !== undefined) this.error("One #id per instance", t);
				else node.id = t.value;
				continue;
			}
			if (t.type === "attribute") {
				const eq = t.value.indexOf("=");
				const key = t.value.slice(0, eq);
				if (key === "id") this.error("Ids are written #name", t);
				else if (key === "data")
					this.error(
						'data= is gone: content is `"{path}"`, media is `src=path`',
						t,
					);
				else node.pairs[key] = t.value.slice(eq + 1);
				continue;
			}
			if (t.type === "arrow") {
				this.error(
					`An arrow follows an event: \`$click ${t.value} action\``,
					t,
				);
				this.skipStatement();
				return;
			}
			if (t.type === "hook") {
				this.error(
					`A mode is set on an instance in an override: \`#handle ${t.value}\`; on the tree line it means nothing`,
					t,
				);
				continue;
			}
			if (t.type === "bracket" && t.value.startsWith("(")) {
				this.error("Arguments go directly after the name: `Nav(current)`", t);
				continue;
			}
			if (
				t.type === "identifier" &&
				isLower(t.value) &&
				!KEYWORDS.has(t.value)
			) {
				if (RETIRED[t.value]) {
					this.error(`"${t.value}" is not a keyword; ${RETIRED[t.value]}`, t);
					this.skipStatement();
					return;
				}
				node.words.push(t.value);
				continue;
			}
			const name = node.name ?? node.kind;
			this.error(
				t.type === "identifier" && node.content === undefined
					? `Unexpected "${t.value}" on ${name} line; text is quoted: ${name} "…"`
					: `Unexpected "${t.value}" on ${name} line`,
				t,
			);
			this.skipStatement();
			return;
		}
	}

	/** `list <data> as <item> [direction=row]` with a body. */
	private parseList(): UiNode | undefined {
		const head = this.consume();
		const node = this.newNode("list", head);
		const data = this.peek();
		if (
			data?.type !== "identifier" ||
			!isLowerPath(data.value) ||
			KEYWORDS.has(data.value)
		) {
			this.error(
				"list needs the data to repeat over: `list results as band`",
				data ?? head,
			);
			this.skipStatement();
			this.skipBlock();
			return undefined;
		}
		this.consume();
		node.data = data.value;
		const as = this.peek();
		if (as?.type !== "identifier" || as.value !== "as") {
			this.error(
				`list names its item with as: \`list ${data.value} as item\``,
				as ?? data,
			);
			this.skipStatement();
			this.skipBlock();
			return undefined;
		}
		this.consume();
		const item = this.peek();
		if (
			item?.type !== "identifier" ||
			!isLower(item.value) ||
			KEYWORDS.has(item.value)
		) {
			this.error("Expected an item name after as", item ?? as);
			this.skipStatement();
			this.skipBlock();
			return undefined;
		}
		this.consume();
		node.item = item.value;
		while (!this.atStatementEnd() && this.peek()?.value !== "{") {
			const t = this.consume();
			if (t.type === "attribute") {
				const eq = t.value.indexOf("=");
				node.pairs[t.value.slice(0, eq)] = t.value.slice(eq + 1);
				continue;
			}
			if (t.type === "hash") {
				this.error(
					"A list takes no handle; its items are addressed through the item name",
					t,
				);
				continue;
			}
			this.error(`Unexpected "${t.value}" on list line`, t);
		}
		this.parseChildren(node);
		if (node.children.length === 0)
			this.error("list needs a body: the tree drawn for each item", head);
		return node;
	}

	private parseModal(): UiNode | undefined {
		const head = this.consume();
		const node = this.newNode("modal", head);
		while (!this.atStatementEnd() && this.peek()?.value !== "{") {
			const t = this.consume();
			this.error(`Unexpected "${t.value}" on modal`, t);
		}
		this.parseChildren(node);
		if (node.children.length === 0) this.error("modal needs a body", head);
		return node;
	}

	private parseChildren(node: UiNode): void {
		const head = this.nodeTokens.get(node);
		const label = node.name ?? node.kind;
		// A standard leaf element (Text, Button, Input, …) has no body. A
		// line indented under one is the next line of the enclosing block,
		// which is what the author meant; a brace body is an error.
		if (node.kind === "instance" && node.name && this.standardLeaf(node.name)) {
			if (this.peek()?.value === "{") {
				this.error(`${label} takes no children`, this.peek());
				this.skipBlock();
				return;
			}
			this.endStatement();
			return;
		}
		if (this.peek()?.value === "{") {
			this.parseBlock(() => this.parseChildStatement(node), head, label);
			return;
		}
		if (!this.indentedBlockAhead()) {
			this.endStatement();
			return;
		}
		this.parseBlock(() => this.parseChildStatement(node), head, label);
	}

	/** Is `name` a standard element that draws no children? Known from the
	 * imports alone, so it holds while the tree is still being read. */
	private standardLeaf(name: string): boolean {
		const dot = name.indexOf(".");
		const alias = dot === -1 ? undefined : name.slice(0, dot);
		const bare = dot === -1 ? name : name.slice(dot + 1);
		for (const use of this.uses) {
			if (use.module !== UI_STANDARD_MODULE) continue;
			const hit =
				use.kind === "named"
					? alias === undefined && use.names.includes(bare)
					: alias === use.alias;
			if (!hit) continue;
			const contract = UI_STANDARD_ELEMENTS[bare];
			return (
				!!contract &&
				contract.type !== "stack" &&
				contract.type !== "dialog" &&
				contract.type !== "outlet"
			);
		}
		return false;
	}

	private parseChildStatement(parent: UiNode): void {
		const child = this.parseTreeStatement();
		if (child) parent.children.push(child);
	}

	// ─── when ──────────────────────────────────────────────────────────────────

	/** `when [subject]` and its cases. A `when` is a block like any other;
	 * each case is `condition => result`. In the tree the result is one
	 * tree line, with its own block when it has one; at component level it
	 * is an override block. Which one a `when` is follows from its first
	 * case, and the rest must agree. */
	private parseWhen():
		| { node: UiNode; level: "tree" | "overrides" }
		| undefined {
		const head = this.consume("identifier", "when");
		const node = this.newNode("when", head);
		node.cases = [];
		const subject = this.peek();
		if (subject && !this.atStatementEnd() && subject.value !== "{") {
			if (
				subject.type === "identifier" &&
				isLowerPath(subject.value) &&
				!KEYWORDS.has(subject.value)
			) {
				this.consume();
				node.subject = subject.value;
			} else if (subject.type === "arrow") {
				this.error(
					"when has no condition of its own; each case does: `when` then `cond => result` lines",
					subject,
				);
				this.skipStatement();
				this.skipBlock();
				return undefined;
			} else {
				this.error(
					`when takes a data path as its subject, or nothing; got "${subject.value}"`,
					subject,
				);
				this.skipStatement();
			}
		}
		const state: { level?: "tree" | "overrides"; sawElse: boolean } = {
			sawElse: false,
		};
		this.parseBlock(() => this.parseCase(node, state), head, "when");
		if (node.cases.length === 0)
			this.error("when needs at least one case", head);
		return { node, level: state.level ?? "tree" };
	}

	private parseCase(
		when: UiNode,
		state: { level?: "tree" | "overrides"; sawElse: boolean },
	): void {
		const t = this.peek();
		if (!t) return;
		if (state.sawElse) this.error("else is the last case of a when", t);
		const condition = this.parseCondition(when.subject !== undefined);
		if (!condition) {
			this.skipStatement();
			return;
		}
		if (condition.kind === "else") state.sawElse = true;
		const arrow = this.peek();
		if (arrow?.type !== "arrow") {
			this.error(
				"A case is `condition => result`",
				arrow && !this.atStatementEnd() ? arrow : t,
			);
			this.skipStatement();
			return;
		}
		this.consume();
		this.checkArrow(arrow);
		const kase: UiCase = { condition, nodes: [], overrides: [] };
		this.caseTokens.set(kase, t);

		const next = this.peek();
		const overrides =
			next?.value === "{" ||
			(this.atStatementEnd() && this.nextLineStartsWith("hash"));
		if (overrides) {
			if (state.level === "tree")
				this.error(
					"This when draws tree lines; overrides go in a component-level when",
					next,
				);
			state.level = state.level ?? "overrides";
			this.parseBlock(
				() => {
					const o = this.peek();
					if (o?.type !== "hash") {
						this.error(
							o && isPascal(o.value)
								? `"${o.value}" is a tree line; an override block changes instances the tree declares: #handle …`
								: `An override starts with a handle: #handle …; got "${o?.value}"`,
							o,
						);
						this.skipStatement();
						return;
					}
					const override = this.parseOverride();
					if (override) kase.overrides.push(override);
				},
				t,
				`case ${t.value}`,
			);
		} else if (this.atStatementEnd()) {
			this.error(
				"A case yields one tree line, with its own block when it has one; group several lines in a Stack",
				t,
			);
			this.endStatement();
			this.skipBlock();
			return;
		} else {
			if (state.level === "overrides")
				this.error(
					"This when holds overrides; tree lines go in a when inside the tree",
					t,
				);
			state.level = state.level ?? "tree";
			const child = this.parseTreeStatement();
			if (child) kase.nodes.push(child);
			this.rejectCaseContinuation(t);
		}
		when.cases?.push(kase);
	}

	/** After a case's one tree line: a further line indented under the
	 * case is not its second line. One error; the lines are skipped. */
	private rejectCaseContinuation(caseToken: Token): void {
		const next = this.nextNonTrivia();
		if (
			!next ||
			next.indentLevel <= caseToken.indentLevel ||
			(next.type === "identifier" &&
				(next.value === "end" || next.value === "}"))
		)
			return;
		this.error(
			"A case yields one tree line, with its own block when it has one; group several lines in a Stack",
			next,
		);
		while (true) {
			const t = this.nextNonTrivia();
			if (!t || t.indentLevel <= caseToken.indentLevel) return;
			this.skipTrivia();
			this.skipStatement();
			this.endStatement();
		}
	}

	private nextNonTrivia(): Token | undefined {
		for (let i = this.pos; i < this.tokens.length; i++) {
			const t = this.tokens[i];
			if (!t) continue;
			if (
				t.type === "newline" ||
				t.type === "comment" ||
				t.type === "indent" ||
				t.type === "dedent"
			)
				continue;
			return t;
		}
		return undefined;
	}

	/** After a statement end: does the next line, past the indent, start
	 * with a token of this type? */
	private nextLineStartsWith(type: Token["type"]): boolean {
		for (let i = this.pos; i < this.tokens.length; i++) {
			const t = this.tokens[i];
			if (!t) continue;
			if (
				t.type === "newline" ||
				t.type === "comment" ||
				t.type === "indent" ||
				t.type === "dedent"
			)
				continue;
			return t.type === type;
		}
		return false;
	}

	private parseCondition(hasSubject: boolean): UiCondition | undefined {
		const t = this.consume();
		const needsSubject = (what: string) => {
			if (!hasSubject) {
				this.error(
					`${what} is a value; matching values needs a subject: \`when path\``,
					t,
				);
				return undefined;
			}
			return { kind: "value", value: t.value } as const;
		};
		switch (t.type) {
			case "string":
				return needsSubject(`"${t.value}"`);
			case "tilde": {
				const dot = t.value.indexOf(".");
				const name = dot === -1 ? t.value : t.value.slice(0, dot);
				const mode = dot === -1 ? "" : t.value.slice(dot + 1);
				if (!IO_MODES.has(mode)) {
					this.error(
						`~${name} needs a mode: ~${name}.${UI_IO_MODES.join("|")}`,
						t,
					);
					return undefined;
				}
				if (hasSubject)
					this.error("With a subject, cases are values, not conditions", t);
				return { kind: "io", name, mode: mode as UiIoMode };
			}
			case "hook": {
				if (this.peek()?.type === "bracket")
					this.error(
						`A mode condition takes no value: ${t.value}`,
						this.consume(),
					);
				if (hasSubject)
					this.error("With a subject, cases are values, not conditions", t);
				return { kind: "mode", mode: t.value.slice(1) };
			}
			case "identifier":
				if (t.value === "else") return { kind: "else" };
				if (/^[0-9]/.test(t.value)) return needsSubject(t.value);
				if (isPascal(t.value)) return needsSubject(t.value);
				if (isLowerPath(t.value) && !KEYWORDS.has(t.value)) {
					if (hasSubject) {
						this.error(
							`With a subject, cases are values: a string, a number, or a Name; "${t.value}" reads as a path`,
							t,
						);
						return undefined;
					}
					return { kind: "path", path: t.value };
				}
				if (IO_MODES.has(t.value)) {
					this.error(`An io mode belongs to an operation: ~name.${t.value}`, t);
					return undefined;
				}
				this.error(`Unexpected "${t.value}" as a case`, t);
				return undefined;
			case "hash":
				this.error(
					`#${t.value} is an instance, not a condition; an input's value is data: \`when #${t.value.split(".")[0]}.value\` is not valid either, bind it through an in`,
					t,
				);
				return undefined;
			default:
				this.error(`Unexpected ${t.type} "${t.value}" as a case`, t);
				return undefined;
		}
	}

	private parseOverride(): UiOverride | undefined {
		const handleToken = this.consume();
		if (handleToken.value.includes(".")) {
			this.error(
				`An override names an instance: #${handleToken.value.split(".")[0]}; its events are handled with \`$event => action\``,
				handleToken,
			);
			this.skipStatement();
			return undefined;
		}
		const override: UiOverride = {
			handle: handleToken.value,
			attributes: {},
			flags: [],
			handlers: [],
		};
		this.overrideTokens.set(override, handleToken);
		while (!this.atStatementEnd()) {
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && t.value.startsWith("$")) {
				const handler = this.parseHandler();
				if (handler) override.handlers.push(handler);
				continue;
			}
			this.consume();
			if (t.type === "string") {
				override.content = t.value;
				continue;
			}
			if (t.type === "attribute") {
				const eq = t.value.indexOf("=");
				override.attributes[t.value.slice(0, eq)] = t.value.slice(eq + 1);
				continue;
			}
			if (t.type === "hook") {
				const mode: { mode: string; value?: string } = {
					mode: t.value.slice(1),
				};
				const value = this.peek();
				if (value?.type === "bracket" && value.value.startsWith("(")) {
					this.consume();
					mode.value = value.value.slice(1, -1).trim();
				}
				override.mode = mode;
				continue;
			}
			if (t.type === "identifier" && t.value === "-") {
				this.error(
					"Flags are not cleared in an override; a when case decides what is drawn",
					t,
				);
				this.skipStatement();
				return override;
			}
			if (
				t.type === "identifier" &&
				isLower(t.value) &&
				!KEYWORDS.has(t.value)
			) {
				override.flags.push(t.value);
				continue;
			}
			this.error(
				`Unexpected "${t.value}" in override of #${override.handle}`,
				t,
			);
		}
		this.endStatement();
		return override;
	}

	// ─── Handlers and actions ──────────────────────────────────────────────────

	/** `$event[(param)] => action` */
	private parseHandler(): UiHandler | undefined {
		const eventToken = this.consume();
		const event = eventToken.value.slice(1);
		if (!isLower(event)) {
			this.error(`Event names are lowercase: $${event}`, eventToken);
			this.skipStatement();
			return undefined;
		}
		let param: string | undefined;
		const bracket = this.peek();
		if (bracket?.type === "bracket" && bracket.value.startsWith("(")) {
			this.consume();
			const names = splitList(bracket.value.slice(1, -1));
			if (names.length !== 1 || !isLower(names[0] ?? ""))
				this.error(
					`A handler binds the event's one value to a name: $${event}(name)`,
					bracket,
				);
			else param = names[0];
		}
		const arrow = this.peek();
		if (arrow?.type !== "arrow") {
			this.error(
				`$${event} needs an action: \`$${event} => action\``,
				arrow && !this.atStatementEnd() ? arrow : eventToken,
			);
			this.skipStatement();
			return undefined;
		}
		this.consume();
		this.checkArrow(arrow);
		const action = this.parseAction();
		if (!action) return undefined;
		const handler: UiHandler = param
			? { event, param, action }
			: { event, action };
		this.handlerTokens.set(handler, eventToken);
		return handler;
	}

	/** `@mode[(value)]`, `$event[(value)]`, `~op`, `go Screen[(args)]` */
	private parseAction(): UiAction | undefined {
		const t = this.peek();
		if (!t || this.atStatementEnd()) {
			this.error("Expected an action after =>", t);
			return undefined;
		}
		this.consume();
		let action: UiAction | undefined;
		switch (t.type) {
			case "hook": {
				action = { kind: "mode", mode: t.value.slice(1) };
				const value = this.peek();
				if (value?.type === "bracket" && value.value.startsWith("(")) {
					this.consume();
					const inner = value.value.slice(1, -1).trim();
					if (inner.includes(",") || inner.includes("="))
						this.error(`A mode takes one value: @${action.mode}(value)`, value);
					else action.value = inner;
				}
				break;
			}
			case "tilde":
				if (t.value.includes(".")) {
					this.error(
						`An action names the operation alone: ~${t.value.split(".")[0]}`,
						t,
					);
				}
				action = { kind: "io", name: t.value.split(".")[0] ?? t.value };
				break;
			case "identifier":
				if (t.value.startsWith("$")) {
					action = { kind: "emit", event: t.value.slice(1) };
					const value = this.peek();
					if (value?.type === "bracket" && value.value.startsWith("(")) {
						this.consume();
						const inner = value.value.slice(1, -1).trim();
						if (inner.includes(",") || inner.includes("="))
							this.error(
								`An event carries one value: $${action.event}(value)`,
								value,
							);
						else action.value = inner;
					}
					break;
				}
				if (t.value === "go") {
					const screen = this.peek();
					if (screen?.type !== "identifier" || !isPascal(screen.value)) {
						this.error(
							"go names a screen: `go Band(id=picked.id)`",
							screen ?? t,
						);
						this.skipStatement();
						return undefined;
					}
					this.consume();
					action = { kind: "go", screen: screen.value, args: {} };
					const args = this.peek();
					if (args?.type === "bracket" && args.value.startsWith("(")) {
						this.consume();
						action.args = this.argList(args.value.slice(1, -1), args);
					}
					break;
				}
				if (isPascal(t.value)) {
					this.error(`Navigation is an action with a verb: go ${t.value}`, t);
					this.skipStatement();
					return undefined;
				}
				if (RETIRED[t.value]) {
					this.error(`"${t.value}" is not a keyword; ${RETIRED[t.value]}`, t);
					this.skipStatement();
					return undefined;
				}
				this.error(
					`Unknown action "${t.value}"; actions are @mode, $event, ~op, go Screen`,
					t,
				);
				this.skipStatement();
				return undefined;
			case "hash":
				this.error(
					`#${t.value} is an instance; an action is @mode, $event, ~op, or go Screen`,
					t,
				);
				this.skipStatement();
				return undefined;
			default:
				this.error(`Unexpected ${t.type} "${t.value}" as an action`, t);
				this.skipStatement();
				return undefined;
		}
		this.actionTokens.set(action, t);
		return action;
	}

	private checkArrow(arrow: Token): void {
		if (arrow.value !== "=>")
			this.error(`The ui arrow is =>, got ${arrow.value}`, arrow);
	}

	/** `(a=b, c)` → { a: "b", c: "c" } */
	private argList(inner: string, token: Token): Record<string, string> {
		const out: Record<string, string> = {};
		for (const part of splitTopLevel(inner)) {
			const eq = part.indexOf("=");
			const key = eq === -1 ? part : part.slice(0, eq).trim();
			const value = eq === -1 ? part : part.slice(eq + 1).trim();
			if (!isLower(key)) {
				this.error(
					`Arguments are named: (name=value), with name short for name=name; got "${part}"`,
					token,
				);
				continue;
			}
			if (out[key] !== undefined)
				this.error(`Duplicate argument "${key}"`, token);
			out[key] = value;
		}
		return out;
	}

	// ─── Blocks and statements ─────────────────────────────────────────────────

	/** A block is either `{ a; b }` or a newline followed by statements up
	 * to `end`. Both call `statement` once per statement. */
	/** A block: `{ a; b }` on one line, or lines closed by `end`. With the
	 * opener's token, a body the author indents is also bounded by that
	 * indent: a line that comes back to the opener's level, or an `end`
	 * shallower than it, means this block never got its `end`. That is one
	 * error, at the opener, and the enclosing block carries on. */
	private parseBlock(
		statement: () => void,
		opener?: Token,
		label = opener?.value ?? "block",
	): void {
		if (this.peek()?.value === "{") {
			const open = this.consume();
			while (true) {
				this.skipSeparators();
				const t = this.peek();
				if (!t) {
					this.error("Missing }", open);
					return;
				}
				if (t.type === "identifier" && t.value === "}") {
					this.consume();
					this.endStatement();
					return;
				}
				const before = this.pos;
				statement();
				if (this.pos === before) this.consume();
			}
		}
		this.consumeIf("newline");
		let bodyIndent: number | undefined;
		const missingEnd = (at: Token) => {
			this.error(
				`${label} on line ${opener?.line} is missing its end; its block ends before line ${at.line}`,
				opener,
			);
		};
		while (true) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) {
				if (opener) missingEnd(this.peek(-1) ?? opener);
				else this.error("Missing end", this.peek(-1));
				return;
			}
			if (t.type === "identifier" && t.value === "end") {
				if (opener && t.indentLevel < opener.indentLevel) {
					missingEnd(t);
					return;
				}
				if (
					opener &&
					bodyIndent !== undefined &&
					bodyIndent > opener.indentLevel &&
					t.indentLevel > opener.indentLevel
				) {
					// An `end` sits at the indent of the line that opened its
					// block; one deeper, inside an indented body, closes nothing.
					this.error(
						`Extra end on line ${t.line}; ${label} on line ${opener.line} closes with an end at its own indent`,
						t,
					);
					this.consume();
					this.endStatement();
					continue;
				}
				this.consume();
				this.endStatement();
				return;
			}
			if (t.type === "identifier" && t.value === "}") {
				this.error("Unexpected }", t);
				this.consume();
				continue;
			}
			if (
				opener &&
				bodyIndent !== undefined &&
				bodyIndent > opener.indentLevel &&
				t.indentLevel <= opener.indentLevel
			) {
				missingEnd(t);
				return;
			}
			bodyIndent ??= t.indentLevel;
			const before = this.pos;
			statement();
			if (this.pos === before) this.consume();
		}
	}

	private atStatementEnd(): boolean {
		const t = this.peek();
		if (!t) return true;
		if (t.type === "newline") return true;
		return t.type === "identifier" && (t.value === ";" || t.value === "}");
	}

	/** Consume a statement terminator (`;` or newline). A closing brace is
	 * left for the block. */
	private endStatement(): void {
		const t = this.peek();
		if (!t) return;
		if (t.type === "newline" || (t.type === "identifier" && t.value === ";"))
			this.consume();
	}

	/** After an action: nothing else may follow on the line. */
	private finishStatement(): void {
		if (!this.atStatementEnd()) {
			this.error(
				`Unexpected "${this.peek()?.value}" after action`,
				this.peek(),
			);
			this.skipStatement();
			return;
		}
		this.endStatement();
	}

	private skipSeparators(): void {
		while (true) {
			const t = this.peek();
			if (!t) return;
			if (
				t.type === "newline" ||
				t.type === "comment" ||
				t.type === "indent" ||
				t.type === "dedent" ||
				(t.type === "identifier" && t.value === ";")
			) {
				this.consume();
				continue;
			}
			return;
		}
	}

	/** Give up on the rest of this statement. The terminator is left for
	 * the enclosing loop, so a line that failed halfway is one error and
	 * the next line parses on its own. */
	private skipStatement(): void {
		while (!this.atStatementEnd()) this.consume();
	}

	private indentedBlockAhead(): boolean {
		for (let i = this.pos; i < this.tokens.length; i++) {
			const t = this.tokens[i];
			if (!t) continue;
			if (
				t.type === "newline" ||
				t.type === "comment" ||
				t.type === "directive"
			)
				continue;
			return t.type === "indent";
		}
		return false;
	}

	private skipBlock(): void {
		if (this.peek()?.value === "{") {
			let depth = 0;
			while (true) {
				const t = this.peek();
				if (!t) return;
				this.consume();
				if (t.value === "{") depth++;
				if (t.value === "}") {
					depth--;
					if (depth <= 0) break;
				}
			}
			this.endStatement();
			return;
		}
		if (!this.indentedBlockAhead()) return;
		let depth = 0;
		while (true) {
			const t = this.peek();
			if (!t) return;
			this.consume();
			if (t.type === "indent") depth++;
			if (t.type === "dedent") {
				depth--;
				if (depth <= 0) break;
			}
		}
		this.skipTrivia();
		if (this.peek()?.value === "end") {
			this.consume();
			this.endStatement();
		}
	}

	// ─── Resolution and checks ─────────────────────────────────────────────────

	private finish(ast: UiAST): void {
		const namespaces = new Map<string, string>();
		const named = new Map<string, string>();
		for (const use of ast.uses) {
			if (use.kind === "namespace") {
				if (namespaces.has(use.alias))
					this.error(
						`Duplicate namespace alias "${use.alias}"`,
						this.findIdentifier(use.alias),
					);
				namespaces.set(use.alias, use.module);
				continue;
			}
			for (const name of use.names) {
				if (named.has(name))
					this.error(`Duplicate import "${name}"`, this.findIdentifier(name));
				named.set(name, use.module);
			}
		}
		const operations = new Set<string>();
		let openApi = false;
		for (const api of ast.apis) {
			if (api.names.length === 0) openApi = true;
			for (const name of api.names) operations.add(name);
		}

		for (const name of ast.order) {
			const component = ast.components[name];
			if (!component) continue;
			if (named.has(name)) {
				this.error(
					`"${name}" is both imported and declared`,
					this.componentTokens.get(component),
				);
			}
			for (const node of this.allNodes(component))
				this.resolveNode(node, ast, namespaces, named);
		}

		const checkOperation = (io: UiIo) => {
			if (openApi || operations.has(io.name)) return;
			const token = this.ioTokens.get(io);
			if (ast.apis.length === 0)
				this.error(
					`~${io.name} needs an api declaration: \`api "<module>" ${io.name}\``,
					token,
				);
			else
				this.error(
					`~${io.name} is not an operation of any declared api; add it to the api line`,
					token,
				);
		};
		for (const io of ast.io) checkOperation(io);
		for (const name of ast.order) {
			for (const io of ast.components[name]?.io ?? []) checkOperation(io);
		}

		for (const name of ast.order) {
			const component = ast.components[name];
			if (component) this.computeEmits(component);
		}
		for (const name of ast.order) {
			const component = ast.components[name];
			if (component) this.computeScope(component, ast);
		}
		for (const name of ast.order) {
			const component = ast.components[name];
			if (component) this.checkComponent(component, ast);
		}

		this.checkLayouts(ast);

		// Where the app opens: the screen at `/`.
		const screens = ast.order.filter(
			(n) => ast.components[n]?.route !== undefined,
		);
		const entry = screens.find((n) => ast.components[n]?.route === "/");
		if (entry) ast.entry = entry;
		else if (screens.length > 0) {
			const first = ast.components[screens[0] ?? ""];
			this.error(
				"No screen has route=/; that is where the app opens",
				first ? this.componentTokens.get(first) : undefined,
			);
		}
	}

	private resolveNode(
		node: UiNode,
		ast: UiAST,
		namespaces: Map<string, string>,
		named: Map<string, string>,
	): void {
		const token = this.nodeTokens.get(node);
		if (node.kind === "when") return;
		if (node.kind === "modal") return;
		if (node.kind === "list") {
			for (const [key, value] of Object.entries(node.pairs)) {
				if (key !== "direction") {
					this.error(`list has no attribute "${key}"`, token);
					continue;
				}
				node.attributes[key] = value;
			}
			return;
		}
		const raw = node.name ?? "";
		if (raw.includes(".")) {
			const dot = raw.indexOf(".");
			const alias = raw.slice(0, dot);
			const name = raw.slice(dot + 1);
			const module = namespaces.get(alias);
			if (!module) {
				this.error(
					`Unknown namespace "${alias}"; import it with \`use "@module" as ${alias}\``,
					token,
				);
				return;
			}
			node.ref = { kind: "unknown", module, name };
			if (module === UI_STANDARD_MODULE && UI_STANDARD_ELEMENTS[name])
				node.ref = { kind: "element", module, name };
		} else if (ast.components[raw]) {
			node.ref = { kind: "component", name: raw };
		} else {
			const module = named.get(raw);
			if (!module) {
				if (UI_STANDARD_ELEMENTS[raw]) {
					this.error(
						`"${raw}" is not imported; add \`use "${UI_STANDARD_MODULE}" ${raw}\``,
						token,
					);
				} else {
					this.error(
						`Unresolved "${raw}"; import it or declare it with component ${raw}`,
						token,
					);
				}
				return;
			}
			node.ref =
				module === UI_STANDARD_MODULE && UI_STANDARD_ELEMENTS[raw]
					? { kind: "element", module, name: raw }
					: { kind: "unknown", module, name: raw };
		}

		if (node.ref.kind === "component") {
			const target = ast.components[node.ref.name];
			const params = target?.params ?? [];
			for (const key of Object.keys(node.args)) {
				if (!params.includes(key))
					this.error(`${node.ref.name} has no parameter "${key}"`, token);
			}
			for (const word of node.words) {
				if ((UI_UNIVERSAL_FLAGS as readonly string[]).includes(word)) {
					node.flags.push(word);
					continue;
				}
				this.error(
					`${node.ref.name} is a component; "${word}" is not a flag it takes. Arguments go in parens: ${node.ref.name}(${word})`,
					token,
				);
			}
			for (const key of Object.keys(node.pairs)) {
				this.error(
					`Arguments to ${node.ref.name} go in parens: ${node.ref.name}(${key}=…)`,
					token,
				);
			}
			if (node.content !== undefined)
				this.error(
					`${node.ref.name} is a component; it takes arguments, not content`,
					token,
				);
			if (node.children.length > 0)
				this.error(
					`${node.ref.name} is a component; it takes arguments, not children`,
					token,
				);
			return;
		}

		if (Object.keys(node.args).length > 0)
			this.error(
				`${node.ref.name} is an element; it takes attributes (key=value), not arguments`,
				token,
			);
		const contract =
			node.ref.kind === "element"
				? UI_STANDARD_ELEMENTS[node.ref.name]
				: undefined;
		for (const word of node.words) {
			if (
				contract &&
				!contract.flags.includes(word) &&
				!(UI_UNIVERSAL_FLAGS as readonly string[]).includes(word)
			) {
				this.error(`${node.ref.name} has no flag "${word}"`, token);
				continue;
			}
			node.flags.push(word);
		}
		for (const [key, value] of Object.entries(node.pairs)) {
			if (contract && !contract.attributes.includes(key)) {
				this.error(`${node.ref.name} has no attribute "${key}"`, token);
				continue;
			}
			node.attributes[key] = value;
		}
	}

	private computeEmits(component: UiComponent): void {
		for (const { action } of this.allActions(component)) {
			if (action.kind === "emit")
				component.emits[action.event] =
					component.emits[action.event] || action.value !== undefined;
		}
	}

	private computeScope(component: UiComponent, ast: UiAST): void {
		const scope = new Set<string>([
			...component.params,
			...component.routeParams,
		]);
		for (const io of ast.io) scope.add(io.name);
		for (const io of component.io) scope.add(io.name);
		component.scope = [...scope];
	}

	private checkComponent(component: UiComponent, ast: UiAST): void {
		const token = this.componentTokens.get(component);
		if (component.tree.length === 0)
			this.error(`${component.name} has no tree`, token);

		// Every name is declared once.
		const declared = new Map<string, Token | undefined>();
		const declare = (name: string, at: Token | undefined) => {
			if (declared.has(name)) {
				this.error(
					`"${name}" is declared twice in ${component.name}; every name in a component is declared once`,
					at,
				);
				return;
			}
			declared.set(name, at);
		};
		for (const io of ast.io) declared.set(io.name, this.ioTokens.get(io));
		for (const p of component.params) declare(p, token);
		for (const p of component.routeParams) declare(p, token);
		for (const io of component.io) declare(io.name, this.ioTokens.get(io));
		for (const mode of component.modes)
			if (mode.param) declare(mode.param, this.modeTokens.get(mode));
		const handles = this.handles(component);
		for (const node of this.allNodes(component)) {
			const nt = this.nodeTokens.get(node);
			if (node.kind === "list" && node.item) declare(node.item, nt);
			for (const h of node.handlers)
				if (h.param) declare(h.param, this.handlerTokens.get(h));
		}
		for (const when of component.whens) {
			for (const kase of when.cases ?? []) {
				for (const o of kase.overrides) {
					for (const h of o.handlers)
						if (h.param) declare(h.param, this.handlerTokens.get(h));
				}
			}
		}

		const ids = new Set<string>();
		for (const node of this.allNodes(component)) {
			if (node.id === undefined) continue;
			if (ids.has(node.id))
				this.error(
					`Duplicate #${node.id} in ${component.name}`,
					this.nodeTokens.get(node),
				);
			ids.add(node.id);
		}

		const modeParams = new Map(
			component.modes.map((m) => [m.name, m.param] as const),
		);

		// The tree, with what is local where.
		this.walk(
			component.tree,
			new Set(),
			(node, locals) => {
				const nt = this.nodeTokens.get(node);
				switch (node.kind) {
					case "list":
						if (node.data)
							this.checkDataRef(node.data, component, locals, handles, nt);
						break;
					case "when":
						this.checkWhen(node, component, locals, handles, ast);
						break;
					case "instance": {
						for (const value of Object.values(node.args))
							this.checkDataRef(value, component, locals, handles, nt);
						for (const [key, value] of Object.entries(node.attributes)) {
							if (key === "to")
								this.checkScreenCall(
									value,
									component,
									locals,
									handles,
									ast,
									nt,
								);
							else if (
								UI_DATA_ATTRIBUTES.has(key) ||
								(key === "value" && isDataPath(value))
							)
								this.checkDataRef(value, component, locals, handles, nt);
						}
						if (node.content !== undefined)
							for (const path of interpolations(node.content))
								this.checkDataRef(path, component, locals, handles, nt);
						for (const h of node.handlers)
							this.checkHandler(h, node, component, locals, handles, ast);
						break;
					}
				}
			},
			component,
		);

		// Component-level when: overrides.
		for (const when of component.whens) {
			this.checkWhen(when, component, new Set(), handles, ast);
			for (const kase of when.cases ?? []) {
				const locals = new Set<string>();
				if (kase.condition.kind === "mode") {
					const param = modeParams.get(kase.condition.mode);
					if (param) locals.add(param);
				}
				for (const o of kase.overrides)
					this.checkOverride(o, component, locals, handles, ast);
			}
		}

		// Io: arguments and outcomes.
		for (const io of component.io) {
			const it = this.ioTokens.get(io);
			for (const value of Object.values(io.args))
				this.checkDataRef(value, component, new Set(), handles, it);
			for (const outcome of io.outcomes) {
				if (outcome.mode === "empty" && io.kind === "out")
					this.error(`empty is a mode of an in, not of ~${io.name}`, it);
				this.checkAction(
					outcome.action,
					component,
					new Set(),
					handles,
					ast,
					this.actionTokens.get(outcome.action) ?? it,
				);
			}
		}

		// A child that emits must be heard.
		for (const node of this.allNodes(component)) {
			if (node.ref?.kind !== "component" || this.broken.has(node)) continue;
			const child = ast.components[node.ref.name];
			const handled = new Set(node.handlers.map((h) => h.event));
			for (const event of Object.keys(child?.emits ?? {})) {
				if (handled.has(event)) continue;
				this.error(
					`${node.ref.name} emits $${event} and ${component.name} never handles it: \`${node.ref.name}(…) $${event} => …\``,
					this.nodeTokens.get(node),
				);
			}
		}
	}

	/** Visit every node of a tree with the names local to it: list items
	 * inside a list body, a mode's parameter inside `when @mode`. */
	private walk(
		nodes: UiNode[],
		locals: Set<string>,
		visit: (node: UiNode, locals: Set<string>) => void,
		component?: UiComponent,
	): void {
		for (const node of nodes) {
			visit(node, locals);
			if (node.kind === "list") {
				const inner = new Set(locals);
				if (node.item) inner.add(node.item);
				this.walk(node.children, inner, visit, component);
				continue;
			}
			if (node.kind === "when") {
				for (const kase of node.cases ?? []) {
					const inner = new Set(locals);
					if (kase.condition.kind === "mode" && component) {
						const param = component.modes.find(
							(m) => m.name === (kase.condition as { mode: string }).mode,
						)?.param;
						if (param) inner.add(param);
					}
					this.walk(kase.nodes, inner, visit, component);
				}
				continue;
			}
			this.walk(node.children, locals, visit, component);
		}
	}

	private checkWhen(
		when: UiNode,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		ast: UiAST,
	): void {
		const token = this.nodeTokens.get(when);
		if (when.subject !== undefined)
			this.checkDataRef(when.subject, component, locals, handles, token);
		for (const kase of when.cases ?? []) {
			const ct = this.caseTokens.get(kase);
			const c = kase.condition;
			switch (c.kind) {
				case "io":
					if (!this.ioDeclared(c.name, component, ast))
						this.error(
							`~${c.name} is not declared in ${component.name}: \`in ~${c.name}\` or \`out ~${c.name}\``,
							ct,
						);
					break;
				case "mode":
					if (!component.modes.some((m) => m.name === c.mode))
						this.error(
							`@${c.mode} is not a mode of ${component.name}; declare it on the header`,
							ct,
						);
					break;
				case "path":
					this.checkDataRef(c.path, component, locals, handles, ct);
					break;
				case "value":
					if (isPascal(c.value) && !ast.components[c.value])
						this.error(`"${c.value}" is not declared`, ct);
					break;
			}
		}
	}

	private checkOverride(
		o: UiOverride,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		ast: UiAST,
	): void {
		const token = this.overrideTokens.get(o);
		const node = handles.get(o.handle);
		if (!node) {
			this.error(`#${o.handle} is not a handle in ${component.name}`, token);
			return;
		}
		const child =
			node.ref?.kind === "component"
				? ast.components[node.ref.name]
				: undefined;
		const contract =
			node.ref?.kind === "element"
				? UI_STANDARD_ELEMENTS[node.ref.name]
				: undefined;
		if (o.content !== undefined) {
			if (child)
				this.error(`${child.name} is a component; it takes no content`, token);
			else
				for (const path of interpolations(o.content))
					this.checkDataRef(path, component, locals, handles, token);
		}
		for (const [key, value] of Object.entries(o.attributes)) {
			if (child) {
				this.error(
					`#${o.handle} is a ${child.name}; its arguments are set where it is used, not in an override`,
					token,
				);
				continue;
			}
			if (contract && !contract.attributes.includes(key))
				this.error(`${node.name} has no attribute "${key}"`, token);
			else if (key === "to")
				this.checkScreenCall(value, component, locals, handles, ast, token);
			else if (
				UI_DATA_ATTRIBUTES.has(key) ||
				(key === "value" && isDataPath(value))
			)
				this.checkDataRef(value, component, locals, handles, token);
		}
		for (const flag of o.flags) {
			if (
				contract &&
				!contract.flags.includes(flag) &&
				!(UI_UNIVERSAL_FLAGS as readonly string[]).includes(flag)
			)
				this.error(`${node.name} has no flag "${flag}"`, token);
			if (child && !(UI_UNIVERSAL_FLAGS as readonly string[]).includes(flag))
				this.error(
					`${child.name} is a component; "${flag}" is not a flag it takes`,
					token,
				);
		}
		if (o.mode) {
			if (!child) {
				this.error(
					`@${o.mode.mode} sets a component's mode; #${o.handle} is not a component instance`,
					token,
				);
			} else {
				const mode = child.modes.find((m) => m.name === o.mode?.mode);
				if (!mode)
					this.error(`${child.name} has no mode @${o.mode.mode}`, token);
				else if (mode.param && o.mode.value === undefined)
					this.error(
						`@${mode.name} takes a value: @${mode.name}(${mode.param})`,
						token,
					);
				else if (!mode.param && o.mode.value !== undefined)
					this.error(`@${mode.name} takes no value`, token);
				if (o.mode.value !== undefined)
					this.checkDataRef(o.mode.value, component, locals, handles, token);
			}
		}
		for (const h of o.handlers)
			this.checkHandler(h, node, component, locals, handles, ast);
	}

	private checkHandler(
		h: UiHandler,
		node: UiNode,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		ast: UiAST,
	): void {
		const token = this.handlerTokens.get(h) ?? this.nodeTokens.get(node);
		const events = this.eventsOf(node, ast);
		let carries = false;
		if (events && !events.includes(h.event)) {
			this.error(
				`${node.name ?? "it"} does not fire $${h.event}${events.length ? `; it fires ${events.map((e) => `$${e}`).join(", ")}` : ""}`,
				token,
			);
		} else if (node.ref?.kind === "component") {
			carries = ast.components[node.ref.name]?.emits[h.event] ?? false;
		}
		if (h.param && !carries) {
			this.error(
				`$${h.event} carries no value; nothing binds to "${h.param}"`,
				token,
			);
		}
		const inner = new Set(locals);
		if (h.param) inner.add(h.param);
		this.checkAction(
			h.action,
			component,
			inner,
			handles,
			ast,
			this.actionTokens.get(h.action) ?? token,
		);
	}

	private checkAction(
		action: UiAction,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		ast: UiAST,
		token: Token | undefined,
	): void {
		switch (action.kind) {
			case "mode": {
				const mode = component.modes.find((m) => m.name === action.mode);
				if (!mode) {
					this.error(
						`@${action.mode} is not a mode of ${component.name}; declare it on the header: \`… @${action.mode}\``,
						token,
					);
					break;
				}
				if (mode.param && action.value === undefined)
					this.error(
						`@${mode.name} takes a value: @${mode.name}(${mode.param})`,
						token,
					);
				else if (!mode.param && action.value !== undefined)
					this.error(`@${mode.name} takes no value`, token);
				if (action.value !== undefined)
					this.checkDataRef(action.value, component, locals, handles, token);
				break;
			}
			case "emit":
				if (action.value !== undefined)
					this.checkDataRef(action.value, component, locals, handles, token);
				break;
			case "io":
				if (!this.ioDeclared(action.name, component, ast))
					this.error(
						`~${action.name} is not declared in ${component.name}: \`out ~${action.name}(…)\` before the tree`,
						token,
					);
				break;
			case "go":
				this.checkScreenArgs(
					action.screen,
					action.args,
					component,
					locals,
					handles,
					ast,
					token,
				);
				break;
		}
	}

	/** `to=Band(id=show.band.id)` */
	private checkScreenCall(
		value: string,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		ast: UiAST,
		token: Token | undefined,
	): void {
		const call = parseCall(value);
		if (!call) {
			this.error(`to= names a screen: to=Band(id=…); got "${value}"`, token);
			return;
		}
		const args = this.argList(call.args, token ?? (this.peek() as Token));
		this.checkScreenArgs(
			call.name,
			args,
			component,
			locals,
			handles,
			ast,
			token,
		);
	}

	private checkScreenArgs(
		name: string,
		args: Record<string, string>,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		ast: UiAST,
		token: Token | undefined,
	): void {
		const screen = ast.components[name];
		if (!screen) {
			this.error(`"${name}" is not declared`, token);
			return;
		}
		if (screen.route === undefined) {
			this.error(
				`${name} is a ${screen.isLayout ? "layout" : "component"}, not a screen; only screens are navigation targets`,
				token,
			);
			return;
		}
		for (const param of screen.routeParams) {
			if (args[param] === undefined)
				this.error(`${name} needs ${param}: \`${name}(${param}=…)\``, token);
		}
		for (const key of Object.keys(args)) {
			if (!screen.routeParams.includes(key))
				this.error(`${name} has no route param "${key}"`, token);
		}
		for (const value of Object.values(args))
			this.checkDataRef(value, component, locals, handles, token);
	}

	/** A layout has exactly one Outlet; nothing else has any. A screen's
	 * `layout=` must name a layout; with one layout declared and none named,
	 * every screen uses it. */
	private checkLayouts(ast: UiAST): void {
		const layouts = ast.order.filter((n) => ast.components[n]?.isLayout);
		for (const name of ast.order) {
			const component = ast.components[name];
			if (!component) continue;
			const outlets = this.allNodes(component).filter(
				(n) => n.ref?.kind === "element" && n.ref.name === "Outlet",
			);
			const token = this.componentTokens.get(component);
			if (component.isLayout) {
				if (outlets.length !== 1) {
					this.error(
						`layout ${name} needs exactly one Outlet, where the screen goes; it has ${outlets.length}`,
						token,
					);
				}
			} else if (outlets.length > 0) {
				this.error(
					`Outlet is only valid inside a layout`,
					this.nodeTokens.get(outlets[0] as UiNode),
				);
			}
			if (component.route === undefined) continue;
			if (component.layoutName !== undefined) {
				const layout = ast.components[component.layoutName];
				const lt = this.layoutTokens.get(component);
				if (!layout?.isLayout) {
					this.error(
						`layout=${component.layoutName} does not name a layout`,
						lt,
					);
				} else {
					component.usesLayout = component.layoutName;
					for (const key of Object.keys(component.layoutArgs)) {
						if (!layout.params.includes(key))
							this.error(`${layout.name} has no parameter "${key}"`, lt);
					}
					const handles = this.handles(component);
					for (const value of Object.values(component.layoutArgs))
						this.checkDataRef(value, component, new Set(), handles, lt);
				}
			} else if (layouts.length === 1) {
				component.usesLayout = layouts[0];
			} else if (layouts.length > 1) {
				this.error(
					`${name} must say which layout wraps it (layout=${layouts.join("|")}); the document declares more than one`,
					token,
				);
			}
		}
	}

	/** A value that must resolve to something: `band.name`, `#qty.value`,
	 * `picked`, `Search`, `1`, `"x"`. */
	private checkDataRef(
		value: string,
		component: UiComponent,
		locals: Set<string>,
		handles: Map<string, UiNode>,
		token: Token | undefined,
	): void {
		const head = value.split(".")[0] ?? value;
		if (head.startsWith("#")) {
			const rest = value.slice(head.length);
			if (!handles.has(head.slice(1)))
				this.error(`${head} is not a handle in ${component.name}`, token);
			else if (rest !== ".value")
				this.error(
					`An instance has one readable property: ${head}.value`,
					token,
				);
			return;
		}
		if (head.startsWith("~")) {
			this.error(
				`An operation's data is its bare name: ${value.slice(1)}; ${head} is the request`,
				token,
			);
			return;
		}
		if (head.startsWith("$") || head.startsWith("@")) {
			this.error(`"${value}" is not data`, token);
			return;
		}
		if (!isLower(head)) return; // a Name, a number, or quoted text
		if (locals.has(head) || component.scope.includes(head)) return;
		if (handles.has(head)) {
			this.error(
				`"${value}" is a bare name; an instance's value is addressed through its handle: #${value}`,
				token,
			);
			return;
		}
		this.error(
			`"${value}" is not supplied in ${component.name}: no parameter, route param, in, list item, or handler param provides "${head}"`,
			token,
		);
	}

	private ioDeclared(
		name: string,
		component: UiComponent,
		ast: UiAST,
	): boolean {
		return (
			component.io.some((io) => io.name === name) ||
			ast.io.some((io) => io.name === name)
		);
	}

	private eventsOf(node: UiNode, ast: UiAST): string[] | undefined {
		if (!node.ref) return undefined;
		if (node.ref.kind === "component")
			return Object.keys(ast.components[node.ref.name]?.emits ?? {});
		if (node.ref.kind === "element")
			return [
				UI_UNIVERSAL_EVENT,
				...(UI_STANDARD_ELEMENTS[node.ref.name]?.events ?? []),
			];
		return undefined;
	}

	private handles(component: UiComponent): Map<string, UiNode> {
		const out = new Map<string, UiNode>();
		for (const node of this.allNodes(component)) {
			if (node.id !== undefined) out.set(node.id, node);
		}
		return out;
	}

	private allNodes(component: UiComponent): UiNode[] {
		const out: UiNode[] = [];
		this.walk(component.tree, new Set(), (node) => {
			out.push(node);
		});
		return out;
	}

	/** Every action in a component, wherever it is written. */
	private allActions(component: UiComponent): { action: UiAction }[] {
		const out: { action: UiAction }[] = [];
		for (const node of this.allNodes(component))
			for (const h of node.handlers) out.push({ action: h.action });
		for (const when of component.whens)
			for (const kase of when.cases ?? [])
				for (const o of kase.overrides)
					for (const h of o.handlers) out.push({ action: h.action });
		for (const io of component.io)
			for (const outcome of io.outcomes) out.push({ action: outcome.action });
		return out;
	}

	private findIdentifier(value: string): Token | undefined {
		return this.tokens.find(
			(t) => t.type === "identifier" && t.value === value,
		);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isPascal(value: string): boolean {
	if (value.includes(".")) {
		const [alias, ...rest] = value.split(".");
		return (
			/^[A-Z][A-Za-z0-9_]*$/.test(alias ?? "") &&
			rest.length === 1 &&
			/^[A-Z][A-Za-z0-9_]*$/.test(rest[0] ?? "")
		);
	}
	return /^[A-Z][A-Za-z0-9_]*$/.test(value);
}

function isLower(value: string): boolean {
	return /^[a-z_][A-Za-z0-9_]*$/.test(value);
}

/** `show.soldOut`, `session.user.name`: a lowercase name with optional
 * dotted segments. */
function isLowerPath(value: string): boolean {
	return /^[a-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value);
}

/** `band.name`, `#qty.value`: a dotted path whose head is a name or a
 * handle. A bare name is not a path. */
export function isDataPath(value: string): boolean {
	return /^#?[a-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value);
}

/** `(a, b)` contents → ["a", "b"]. */
function splitList(inner: string): string[] {
	return inner
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Split on commas outside parentheses and quotes. */
function splitTopLevel(inner: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quoted = false;
	let current = "";
	for (const ch of inner) {
		if (ch === '"') quoted = !quoted;
		if (!quoted) {
			if (ch === "(") depth++;
			if (ch === ")") depth--;
			if (ch === "," && depth === 0) {
				if (current.trim()) out.push(current.trim());
				current = "";
				continue;
			}
		}
		current += ch;
	}
	if (current.trim()) out.push(current.trim());
	return out;
}

/** `Band(id=x)` → { name: "Band", args: "id=x" }; `Search` → args "". */
export function parseCall(
	value: string,
): { name: string; args: string } | undefined {
	const m = /^([A-Z][A-Za-z0-9_]*)(?:\((.*)\))?$/s.exec(value.trim());
	if (!m) return undefined;
	return { name: m[1] ?? "", args: m[2] ?? "" };
}

/** The data paths inside `{…}` in a content string. */
export function interpolations(content: string): string[] {
	return [...content.matchAll(/\{([^}]+)\}/g)].map((m) => (m[1] ?? "").trim());
}
