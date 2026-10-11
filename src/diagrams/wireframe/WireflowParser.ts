import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult, Token } from "../../types.ts";
import { extractLabel, isInteractionKind } from "./WireframeParser.ts";
import type {
	WireflowAST,
	WireflowEdge,
	WireflowNode,
	WireflowScreenRef,
} from "./wireframeTypes.ts";

/** The `[*]` pseudo-node used for entry and exit edges, as in state diagrams. */
export const WIREFLOW_TERMINAL = "[*]";

const KEYWORDS = new Set(["wireflow", "screen", "decision", "title", "end"]);

/**
 * Wireflow: screens (optionally in a named state) and decisions as nodes;
 * interactions as edges.
 *
 *   wireflow
 *     decision paymentOk "Payment ok?"
 *     [*] --> Login
 *     Login -->|goto signupLink| Signup
 *     Login -->|call onSignIn| Home
 *     Home -->|state create| Home.paying
 *     Home.paying -->|call onPay| paymentOk
 *     paymentOk -->|yes| ShowDetail
 *     paymentOk -->|no| Home.paying
 *     Home -->|call onLogout| [*]
 *   end
 *
 * An edge leaving a screen is labeled `kind [trigger]` — the same goto /
 * state / call vocabulary a wireframe declares on its components, with the
 * component id (or hook name) that fires it. An edge leaving a decision is
 * labeled with its branch. Entry and exit edges use `[*]`.
 */
export class WireflowParser extends DiagramParser<WireflowAST> {
	private order: string[] = [];
	private nodes: Record<string, WireflowNode> = {};
	private edges: WireflowEdge[] = [];
	private declaredScreens = new Set<string>();
	private title?: string;

	/** Raw edges, resolved once every decision declaration has been seen. */
	private pending: {
		from: string;
		to: string;
		label?: string;
		fromToken: Token;
		arrowToken: Token;
		toToken: Token;
	}[] = [];

	parse(): ParseResult<WireflowAST> {
		this.skipTrivia();
		const first = this.peek();
		if (first?.type === "identifier" && first.value === "wireflow") {
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
				break;
			}
			this.parseStatement();
		}

		this.resolveEdges();

		const ast: WireflowAST = {
			type: "wireflow",
			order: this.order,
			nodes: this.nodes,
			edges: this.edges,
			entries: this.edges
				.filter((e) => e.from === WIREFLOW_TERMINAL)
				.map((e) => e.to),
			exits: this.edges
				.filter((e) => e.to === WIREFLOW_TERMINAL)
				.map((e) => e.from),
		};
		if (this.title) ast.title = this.title;
		return this.result(ast);
	}

	private parseStatement(): void {
		const token = this.peek();
		if (!token) return;

		if (token.type === "identifier") {
			switch (token.value) {
				case "title": {
					this.consume();
					this.consumeIf("identifier", ":");
					const parts: string[] = [];
					while (true) {
						const t = this.peek();
						if (!t || t.type === "newline") break;
						parts.push(t.value);
						this.consume();
					}
					this.consumeIf("newline");
					this.title = parts.join(" ").trim() || undefined;
					return;
				}
				case "screen":
					this.parseScreenDeclaration();
					return;
				case "decision":
					this.parseDecisionDeclaration();
					return;
				case "ref":
					this.error(
						"`ref` is legacy wireflow syntax; write edges as `Screen -->|kind trigger| Target`",
						token,
					);
					this.skipToEndOfLine();
					this.skipLegacyBlock();
					return;
				case "use":
				case "define":
				case "state":
				case "viewport":
				case "repeat":
				case "modal":
					this.error(
						`"${token.value}" belongs to wireframe, not wireflow`,
						token,
					);
					this.skipToEndOfLine();
					return;
			}
		}

		if (token.type === "identifier" || token.type === "bracket") {
			this.parseEdge();
			return;
		}

		this.error(`Unexpected ${token.type} "${token.value}"`, token);
		this.skipToEndOfLine();
	}

	private parseScreenDeclaration(): void {
		this.consume("identifier", "screen");
		const nameToken = this.peek();
		if (nameToken?.type !== "identifier") {
			this.error("Expected a screen name", nameToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const rest = this.peek();
		if (rest && rest.type !== "newline") {
			this.error(
				"A wireflow screen declaration is just `screen Name`; its contents live in the wireframe",
				rest,
			);
			this.skipToEndOfLine();
		} else {
			this.consumeIf("newline");
		}
		if (this.hasIndentedBlockAhead()) {
			this.error("A wireflow screen has no body", nameToken);
			this.skipLegacyBlock();
		}
		const ref = parseScreenRef(nameToken.value);
		if (!ref) {
			this.error(`Invalid screen name "${nameToken.value}"`, nameToken);
			return;
		}
		this.declaredScreens.add(nameToken.value);
		this.touchScreen(nameToken.value, ref);
	}

	private parseDecisionDeclaration(): void {
		this.consume("identifier", "decision");
		const idToken = this.peek();
		if (idToken?.type !== "identifier") {
			this.error(
				'Expected a decision id: `decision paymentOk "Question?"`',
				idToken,
			);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const id = idToken.value;
		if (!/^[a-z_][A-Za-z0-9_]*$/.test(id)) {
			this.error(
				`Decision ids are lowercase identifiers, got "${id}"`,
				idToken,
			);
		}
		const questionToken = this.peek();
		let question = id;
		if (questionToken?.type === "string") {
			question = this.consume().value;
		}
		const rest = this.peek();
		if (rest && rest.type !== "newline") {
			this.error(`Unexpected "${rest.value}" after decision`, rest);
			this.skipToEndOfLine();
		} else {
			this.consumeIf("newline");
		}
		if (this.hasIndentedBlockAhead()) {
			this.error(
				"Decision branches are edges: `decisionId -->|yes| Target`, not an indented block",
				idToken,
			);
			this.skipLegacyBlock();
		}

		const existing = this.nodes[id];
		if (existing) {
			this.error(`Duplicate node id "${id}"`, idToken);
			return;
		}
		this.nodes[id] = { kind: "decision", id, question };
		this.order.push(id);
	}

	private parseEdge(): void {
		const fromToken = this.consume();
		const arrowToken = this.peek();
		if (arrowToken?.type !== "arrow" && arrowToken?.type !== "labeled-arrow") {
			this.error(
				`Expected an edge after "${fromToken.value}": \`${fromToken.value} -->|kind trigger| Target\``,
				arrowToken ?? fromToken,
			);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		if (arrowToken.type === "arrow" && arrowToken.value !== "-->") {
			this.error(`Wireflow edges use -->, got ${arrowToken.value}`, arrowToken);
		}
		const toToken = this.peek();
		if (toToken?.type !== "identifier" && toToken?.type !== "bracket") {
			this.error("Expected a target after the arrow", toToken ?? arrowToken);
			this.skipToEndOfLine();
			return;
		}
		this.consume();
		const rest = this.peek();
		if (rest && rest.type !== "newline") {
			this.error(`Unexpected "${rest.value}" after edge`, rest);
			this.skipToEndOfLine();
		} else {
			this.consumeIf("newline");
		}

		for (const t of [fromToken, toToken]) {
			if (t.type === "bracket" && t.value !== WIREFLOW_TERMINAL) {
				this.error(
					`Unexpected ${t.value}; only [*] is valid as an edge endpoint`,
					t,
				);
				return;
			}
		}

		this.pending.push({
			from: fromToken.value,
			to: toToken.value,
			label:
				arrowToken.type === "labeled-arrow"
					? extractLabel(arrowToken.value)
					: undefined,
			fromToken,
			arrowToken,
			toToken,
		});
	}

	/** Every id that is not a declared decision is a screen. Edges leaving a
	 * decision carry a branch label; edges leaving a screen carry an
	 * interaction. */
	private resolveEdges(): void {
		for (const p of this.pending) {
			for (const [value, token] of [
				[p.from, p.fromToken],
				[p.to, p.toToken],
			] as const) {
				if (value === WIREFLOW_TERMINAL || this.nodes[value]) continue;
				const ref = parseScreenRef(value);
				if (!ref) {
					this.error(
						`Invalid node "${value}"; screens are PascalCase (\`Home\`, \`Home.paying\`) and decisions are declared with \`decision id\``,
						token,
					);
					continue;
				}
				this.touchScreen(value, ref);
			}
		}

		for (const p of this.pending) {
			const edge: WireflowEdge = { from: p.from, to: p.to };
			const fromNode = this.nodes[p.from];
			const toNode = this.nodes[p.to];
			if (p.from !== WIREFLOW_TERMINAL && !fromNode) continue;
			if (p.to !== WIREFLOW_TERMINAL && !toNode) continue;

			if (p.from === WIREFLOW_TERMINAL && p.to === WIREFLOW_TERMINAL) {
				this.error("An edge cannot run from [*] to [*]", p.arrowToken);
				continue;
			}

			if (p.from === WIREFLOW_TERMINAL) {
				if (p.label) {
					this.error("Entry edges from [*] take no label", p.arrowToken);
				}
				if (toNode?.kind === "decision") {
					this.error(
						"Entry edges must lead to a screen, not a decision",
						p.toToken,
					);
				}
				this.edges.push(edge);
				continue;
			}

			if (fromNode?.kind === "decision") {
				if (!p.label) {
					this.error(
						`Edges leaving decision ${p.from} need a branch label: \`${p.from} -->|yes| Target\``,
						p.arrowToken,
					);
				} else {
					edge.branch = p.label;
				}
				this.edges.push(edge);
				continue;
			}

			// Edge leaving a screen.
			if (!p.label) {
				if (p.to === WIREFLOW_TERMINAL) {
					this.edges.push(edge);
					continue;
				}
				this.error(
					`Edges leaving a screen need an interaction: \`${p.from} -->|goto id| ${p.to}\`, \`-->|state id|\`, or \`-->|call hook|\``,
					p.arrowToken,
				);
				this.edges.push(edge);
				continue;
			}

			const words = p.label.split(/\s+/).filter(Boolean);
			const kind = words[0] ?? "";
			if (!isInteractionKind(kind)) {
				this.error(
					`Edge labels start with goto, state, or call, got "${p.label}"`,
					p.arrowToken,
				);
				this.edges.push(edge);
				continue;
			}
			if (words.length > 2) {
				this.error(
					`Edge label "${p.label}" has too many words; expected \`${kind} trigger\``,
					p.arrowToken,
				);
			}
			edge.interaction = kind;
			if (words[1]) edge.trigger = words[1];

			if (kind === "state") {
				const fromRef = fromNode?.kind === "screen" ? fromNode.ref : undefined;
				const toRef = toNode?.kind === "screen" ? toNode.ref : undefined;
				if (p.to === WIREFLOW_TERMINAL || !toRef) {
					this.error(
						"A state edge must target a state of the same screen",
						p.toToken,
					);
				} else if (fromRef && toRef.screen !== fromRef.screen) {
					this.error(
						`A state edge stays within one screen; ${p.from} cannot change state to ${p.to}`,
						p.toToken,
					);
				}
			}
			if (kind === "goto" && toNode?.kind === "decision") {
				this.error(
					"goto leads to a screen; use call to reach a decision",
					p.toToken,
				);
			}
			this.edges.push(edge);
		}
	}

	private touchScreen(id: string, ref: WireflowScreenRef): void {
		if (this.nodes[id]) return;
		this.nodes[id] = { kind: "screen", id, ref };
		this.order.push(id);
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

	private skipLegacyBlock(): void {
		if (!this.hasIndentedBlockAhead()) return;
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
}

/** `Home` → screen Home; `Home.paying` → screen Home in state paying. */
export function parseScreenRef(value: string): WireflowScreenRef | undefined {
	if (KEYWORDS.has(value)) return undefined;
	const m = /^([A-Z][A-Za-z0-9_]*)(?:\.([a-z_][A-Za-z0-9_]*))?$/.exec(value);
	if (!m) return undefined;
	const screen = m[1] ?? value;
	const state = m[2];
	return state ? { screen, state } : { screen };
}
