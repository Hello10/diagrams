import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult, Token } from "../../types.ts";
import type {
	StateDiagramAST,
	StateNode,
	StateNote,
	Transition,
} from "./stateTypes.ts";

export class StateParser extends DiagramParser<StateDiagramAST> {
	private states: StateNode[] = [];
	private stateMap = new Map<string, StateNode>();
	private transitions: Transition[] = [];
	private notes: StateNote[] = [];
	private sourceLines: string[] = [];

	setSource(lines: string[]): this {
		this.sourceLines = lines;
		return this;
	}

	parse(): ParseResult<StateDiagramAST> {
		this.skipTrivia();

		// Opening keyword: stateDiagram-v2 or stateDiagram
		const first = this.peek();
		if (
			first?.type === "identifier" &&
			first.value.startsWith("stateDiagram")
		) {
			this.skipToEndOfLine();
		}

		let title: string | undefined;
		let accTitle: string | undefined;
		let accDescr: string | undefined;

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;

			if (t.type === "identifier" && t.value === "title") {
				this.consume();
				title = this.consumeRestOfLine().trim();
				continue;
			}

			if (t.type === "identifier" && t.value === "accTitle") {
				this.consume();
				this.consumeColon();
				accTitle = this.consumeRestOfLine().trim();
				continue;
			}

			if (t.type === "identifier" && t.value === "accDescr") {
				this.consume();
				this.consumeColon();
				accDescr = this.consumeRestOfLine().trim();
				continue;
			}

			this.parseStatement(this.states);
		}

		return this.result({
			type: "stateDiagram",
			title,
			accTitle,
			accDescr,
			states: this.states,
			transitions: this.transitions,
			notes: this.notes,
		});
	}

	private parseStatement(parentStates: StateNode[]): void {
		this.skipTrivia();
		const t = this.peek();
		if (!t) return;

		// Transition: stateId --> stateId or [*] --> stateId
		// Check if this line is a state identifier or [*] followed by an arrow
		if (t.type === "identifier" || t.type === "bracket") {
			// Look ahead: is next meaningful token an arrow?
			const peek1 = this.peekPastTrivia(1);
			if (peek1?.type === "arrow") {
				this.parseTransition(parentStates);
				return;
			}

			if (t.type === "identifier") {
				// state "label" as ID
				if (t.value === "state") {
					this.parseStateDecl(parentStates);
					return;
				}

				// note left of / right of
				if (t.value === "note") {
					this.parseNote();
					return;
				}

				// Bare state declaration: ID
				const id = this.consume("identifier").value;
				if (!this.stateMap.has(id)) {
					const node: StateNode = { id, kind: this.inferKind(id) };
					this.stateMap.set(id, node);
					parentStates.push(node);
				}
				this.consumeIf("newline");
				return;
			}
		}

		this.skipToEndOfLine();
	}

	private parseTransition(parentStates: StateNode[]): void {
		const fromToken = this.peek();
		const from =
			fromToken?.type === "bracket"
				? this.consume("bracket").value // [*]
				: this.consume("identifier").value;
		this.ensureState(from, parentStates);

		// Consume the arrow token
		if (this.peek()?.type === "arrow") {
			this.consume();
		} else {
			this.consume(); // '--'
			this.consume(); // '>'
		}

		const toToken = this.peek();
		const to =
			toToken?.type === "bracket"
				? this.consume("bracket").value // [*]
				: this.consume("identifier").value;
		this.ensureState(to, parentStates);

		let label: string | undefined;
		// Label comes after ':' — the colon may be a bare identifier token or part of an attribute
		const next = this.peek();
		if (next?.type === "identifier" && next.value === ":") {
			this.consume();
			label = this.consumeRestOfLine().trim() || undefined;
		} else if (next?.type === "attribute" && next.value.startsWith(":")) {
			// Sometimes ':label' is tokenized as attribute ':label'
			label = next.value.slice(1).trim() || undefined;
			this.consume();
		} else {
			this.consumeIf("newline");
		}

		this.transitions.push({ from, to, label });
	}

	private parseStateDecl(parentStates: StateNode[]): void {
		this.consume("identifier", "state");

		let label: string | undefined;
		let id: string;

		// state "label" as ID
		if (this.peek()?.type === "string") {
			label = this.consume("string").value;
			// expect 'as'
			if (this.peek()?.type === "identifier" && this.peek()?.value === "as") {
				this.consume();
			}
			id = this.consume("identifier").value;
		} else {
			id = this.consume("identifier").value;
		}

		// Compound state body: state ID { ... }
		// Represented in our token stream as indented block after newline
		const kind = this.inferKind(id);
		const node: StateNode = { id, label, kind };

		// Look for a block body denoted by '{'
		this.skipTrivia();
		const next = this.peek();
		if (next?.type === "identifier" && next.value === "{") {
			this.consume(); // '{'

			const children: StateNode[] = [];
			while (!this.isAtEnd()) {
				const inner = this.peek();
				if (!inner) break;
				if (inner.type === "identifier" && inner.value === "}") {
					this.consume(); // '}'
					break;
				}
				this.parseStatement(children);
			}
			if (children.length > 0) {
				node.children = children;
			}
		}

		// If the id was auto-created by an earlier transition, merge in the
		// label/children rather than dropping this declaration on the floor.
		const existing = this.stateMap.get(id);
		if (existing) {
			if (label !== undefined) existing.label = label;
			if (node.children) existing.children = node.children;
		} else {
			this.stateMap.set(id, node);
			parentStates.push(node);
		}
	}

	private parseNote(): void {
		this.consume("identifier", "note");

		let position: "left of" | "right of" = "right of";
		const pos = this.peek();
		if (pos?.type === "identifier") {
			if (pos.value === "left") {
				this.consume();
				this.consumeIf("identifier"); // 'of'
				position = "left of";
			} else if (pos.value === "right") {
				this.consume();
				this.consumeIf("identifier"); // 'of'
				position = "right of";
			}
		}

		// State name immediately follows the position keywords
		const stateToken = this.peek();
		if (stateToken?.type !== "identifier") {
			this.skipToEndOfLine();
			return;
		}
		const state = this.consume("identifier").value;

		// Inline note: note right of State1: text
		let text = "";
		const next = this.peek();
		if (next?.type === "identifier" && next.value === ":") {
			this.consume();
			text = this.consumeRestOfLine().trim();
		} else {
			this.consumeIf("newline");
			// Multi-line note body until 'end note'
			const lines: string[] = [];
			while (!this.isAtEnd()) {
				this.skipTrivia();
				const t = this.peek();
				if (!t) break;
				// 'end' keyword ends the note
				if (t.type === "identifier" && t.value === "end") {
					this.consume(); // 'end'
					this.consumeIf("identifier"); // optional 'note'
					this.consumeIf("newline");
					break;
				}
				lines.push(this.consumeRestOfLine().trim());
			}
			text = lines.join(" ");
		}

		this.notes.push({ position, state, text });
	}

	private consumeRestOfLine(): string {
		const firstToken = this.peek();
		if (!firstToken || firstToken.type === "newline") {
			this.consumeIf("newline");
			return "";
		}

		const sourceLine = this.sourceLines[firstToken.line - 1];
		if (sourceLine !== undefined) {
			while (true) {
				const t = this.peek();
				if (!t || t.type === "newline") break;
				this.consume();
			}
			this.consumeIf("newline");
			return sourceLine.slice(firstToken.col - 1).trim();
		}

		const parts: string[] = [];
		while (true) {
			const t = this.peek();
			if (!t || t.type === "newline") break;
			parts.push(t.value);
			this.consume();
		}
		this.consumeIf("newline");
		return parts.join(" ");
	}

	private ensureState(
		id: string,
		parentStates: StateNode[] = this.states,
	): void {
		if (!this.stateMap.has(id)) {
			const node: StateNode = { id, kind: this.inferKind(id) };
			this.stateMap.set(id, node);
			parentStates.push(node);
		}
	}

	private consumeColon(): void {
		const next = this.peek();
		if (next?.type === "identifier" && next.value === ":") {
			this.consume();
		}
	}

	private inferKind(id: string): StateNode["kind"] {
		if (id === "[*]") return "start";
		return "state";
	}

	/**
	 * Peek ahead past trivia tokens to find the token at a logical offset.
	 * Unlike peek(offset), this skips newline/comment/indent/dedent tokens.
	 */
	private peekPastTrivia(logicalOffset: number): Token | undefined {
		let count = 0;
		for (let i = this.pos; i < this.tokens.length; i++) {
			const t = this.tokens[i];
			if (!t) break;
			if (
				t.type === "newline" ||
				t.type === "comment" ||
				t.type === "indent" ||
				t.type === "dedent"
			) {
				continue;
			}
			if (count === logicalOffset) return t;
			count++;
		}
		return undefined;
	}
}
