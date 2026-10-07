import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult, Token } from "../../types.ts";
import type {
	ActivationStatement,
	AltStatement,
	ArrowType,
	BreakStatement,
	LoopStatement,
	MessageStatement,
	NoteStatement,
	ParStatement,
	Participant,
	RectStatement,
	SequenceDiagramAST,
	SequenceStatement,
} from "./sequenceTypes.ts";

// Mermaid sequence arrow patterns (order matters — longer patterns first)
const ARROW_PATTERNS: ArrowType[] = [
	"-->>",
	"-->",
	"->>",
	"->",
	"--x",
	"-x",
	"--)",
	"-)",
];

export class SequenceParser extends DiagramParser<SequenceDiagramAST> {
	private participants: Participant[] = [];
	private participantSet = new Set<string>();
	private statements: SequenceStatement[] = [];
	/** Original source lines, used to reconstruct label text faithfully. */
	private sourceLines: string[];

	constructor(tokens: Token[]) {
		super(tokens);
		// Reconstruct source lines from token positions.
		// We don't get the raw source passed in, so we infer the max line from tokens.
		this.sourceLines = [];
	}

	/** Call this before parse() to provide source lines for faithful label reconstruction. */
	setSource(lines: string[]): this {
		this.sourceLines = lines;
		return this;
	}

	parse(): ParseResult<SequenceDiagramAST> {
		this.skipTrivia();

		// Consume opening keyword
		const first = this.peek();
		if (first?.type === "identifier" && first.value === "sequenceDiagram") {
			this.consume();
			this.consumeIf("newline");
		}

		// Optional title / accTitle / accDescr / autonumber directives at the top
		let title: string | undefined;
		let accTitle: string | undefined;
		let accDescr: string | undefined;

		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;

			if (t.type === "identifier" && t.value === "title") {
				this.consume();
				title = this.consumeRestOfLine();
				continue;
			}
			if (t.type === "identifier" && t.value === "accTitle") {
				this.consume();
				this.consumeIf("attribute"); // skip ':'
				accTitle = this.consumeRestOfLine();
				continue;
			}
			if (t.type === "identifier" && t.value === "accDescr") {
				this.consume();
				this.consumeIf("attribute");
				accDescr = this.consumeRestOfLine();
				continue;
			}
			if (t.type === "identifier" && t.value === "autonumber") {
				this.consume();
				this.consumeIf("newline");
				this.statements.push({ kind: "autonumber" });
				continue;
			}

			// Try to parse a sequence statement
			const stmt = this.parseStatement();
			if (stmt) {
				this.statements.push(stmt);
			}
		}

		const ast: SequenceDiagramAST = {
			type: "sequenceDiagram",
			title,
			accTitle,
			accDescr,
			participants: this.participants,
			statements: this.statements,
		};

		return this.result(ast);
	}

	// ─── Statement dispatch ────────────────────────────────────────────────

	private parseStatement(): SequenceStatement | null {
		this.skipTrivia();
		const t = this.peek();
		if (!t) return null;

		if (t.type === "identifier") {
			switch (t.value) {
				case "participant":
				case "actor":
					return this.parseParticipant();
				case "note":
					return this.parseNote();
				case "activate":
					return this.parseActivation(true);
				case "deactivate":
					return this.parseActivation(false);
				case "loop":
					return this.parseLoop();
				case "alt":
					return this.parseAlt();
				case "par":
					return this.parsePar();
				case "break":
					return this.parseBreak();
				case "rect":
					return this.parseRect();
				case "end":
					// 'end' consumed by the caller in group parsers
					return null;
				default:
					// Might be a message: Actor --> Actor: label
					return this.parseMessageOrSkip();
			}
		}

		// Unrecognized — skip the line
		this.skipToEndOfLine();
		return null;
	}

	// ─── Participant ───────────────────────────────────────────────────────

	private parseParticipant(): SequenceStatement | null {
		const kindToken = this.consume();
		const kind = kindToken.value as "participant" | "actor";

		const actorToken = this.consume("identifier");
		const actor = actorToken.value;

		let alias: string | undefined;
		const next = this.peek();
		if (next?.type === "identifier" && next.value === "as") {
			this.consume(); // 'as'
			// Alias can be a string or identifier
			if (this.peek()?.type === "string") {
				alias = this.consume("string").value;
			} else {
				alias = this.consumeRestOfLine().trim() || undefined;
			}
		} else {
			this.consumeIf("newline");
		}

		// Register if not already known
		if (!this.participantSet.has(actor)) {
			this.participantSet.add(actor);
			this.participants.push({ actor, alias, kind });
		}

		return null; // Participants are stored separately, not as statements
	}

	// ─── Note ─────────────────────────────────────────────────────────────

	private parseNote(): NoteStatement | null {
		this.consume("identifier", "note");

		const posToken = this.peek();
		if (!posToken) {
			this.error("Expected note position (over, left of, right of)");
			this.skipToEndOfLine();
			return null;
		}

		let position: "over" | "left of" | "right of" = "over";
		if (posToken.type === "identifier") {
			if (posToken.value === "over") {
				this.consume();
				position = "over";
			} else if (posToken.value === "left") {
				this.consume();
				this.consumeIf("identifier"); // 'of'
				position = "left of";
			} else if (posToken.value === "right") {
				this.consume();
				this.consumeIf("identifier"); // 'of'
				position = "right of";
			}
		}

		// Actor(s): comma-separated. The tokenizer drops the comma, so for
		// `note over A, B` we see two consecutive identifier tokens.
		const actors: string[] = [];
		const first = this.consume("identifier");
		actors.push(first.value);
		this.ensureParticipant(first.value);

		if (position === "over") {
			const next = this.peek();
			if (
				next?.type === "identifier" &&
				next.value !== ":" &&
				next.value !== "{" &&
				next.value !== "}"
			) {
				actors.push(next.value);
				this.ensureParticipant(next.value);
				this.consume();
			}
		}

		// Note text after ':'
		let text = "";
		const colon = this.peek();
		if (colon?.type === "identifier" && colon.value === ":") {
			this.consume();
			text = this.consumeRestOfLine().trim();
		} else {
			text = this.consumeRestOfLine().trim();
		}

		return { kind: "note", position, actors, text };
	}

	// ─── Activation ────────────────────────────────────────────────────────

	private parseActivation(active: boolean): ActivationStatement {
		this.consume(); // 'activate' | 'deactivate'
		const actor = this.consume("identifier").value;
		this.consumeIf("newline");
		this.ensureParticipant(actor);
		return { kind: "activation", actor, active };
	}

	// ─── Message ───────────────────────────────────────────────────────────

	private parseMessageOrSkip(): MessageStatement | null {
		// Format: Actor ArrowTokens Actor : label
		// The arrow is embedded in the identifier stream (e.g. "-->" appears as arrow token)
		const fromToken = this.consume("identifier");
		const from = fromToken.value;

		// Next should be an arrow token
		const arrowToken = this.peek();
		if (
			!arrowToken ||
			(arrowToken.type !== "arrow" && arrowToken.type !== "labeled-arrow")
		) {
			// Not a message — skip the line
			this.warn(
				`Unrecognised sequence statement starting with "${from}"`,
				fromToken,
			);
			this.skipToEndOfLine();
			return null;
		}

		const rawArrow = this.consume().value;
		const arrow = this.resolveArrow(rawArrow);

		// Handle +/- activation suffixes on arrows (e.g. ->>+, ->>-)
		let activateSuffix: "+" | "-" | undefined;
		const nextAfterArrow = this.peek();
		if (
			nextAfterArrow?.type === "identifier" &&
			(nextAfterArrow.value === "+" || nextAfterArrow.value === "-")
		) {
			activateSuffix = nextAfterArrow.value as "+" | "-";
			this.consume();
		}

		const toToken = this.consume("identifier");
		const to = toToken.value;

		// Label after ':'
		let label = "";
		const colon = this.peek();
		if (colon?.type === "identifier" && colon.value === ":") {
			this.consume();
		}
		label = this.consumeRestOfLine().trim();

		this.ensureParticipant(from);
		this.ensureParticipant(to);

		// Emit implicit activations from +/- suffixes
		if (activateSuffix === "+") {
			this.statements.push({ kind: "activation", actor: to, active: true });
		} else if (activateSuffix === "-") {
			this.statements.push({ kind: "activation", actor: to, active: false });
		}

		return { kind: "message", from, to, label, arrow };
	}

	// ─── Group statements ─────────────────────────────────────────────────

	private parseLoop(): LoopStatement {
		this.consume("identifier", "loop");
		const label = this.consumeRestOfLine().trim();
		const statements = this.parseUntilEnd();
		return { kind: "loop", label, statements };
	}

	private parseAlt(): AltStatement {
		this.consume("identifier", "alt");
		const firstCondition = this.consumeRestOfLine().trim();
		const firstStatements = this.parseUntilElseOrEnd();

		const branches: AltStatement["branches"] = [
			{ condition: firstCondition, statements: firstStatements },
		];

		// Consume additional 'else' branches
		while (true) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && t.value === "else") {
				this.consume();
				const condition = this.consumeRestOfLine().trim();
				const stmts = this.parseUntilElseOrEnd();
				branches.push({ condition, statements: stmts });
			} else if (t.type === "identifier" && t.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			} else {
				break;
			}
		}

		return { kind: "alt", branches };
	}

	private parsePar(): ParStatement {
		this.consume("identifier", "par");
		const firstLabel = this.consumeRestOfLine().trim();
		const firstStatements = this.parseUntilAndOrEnd();

		const branches: ParStatement["branches"] = [
			{ label: firstLabel, statements: firstStatements },
		];

		while (true) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && t.value === "and") {
				this.consume();
				const label = this.consumeRestOfLine().trim();
				const stmts = this.parseUntilAndOrEnd();
				branches.push({ label, statements: stmts });
			} else if (t.type === "identifier" && t.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			} else {
				break;
			}
		}

		return { kind: "par", branches };
	}

	private parseBreak(): BreakStatement {
		this.consume("identifier", "break");
		const label = this.consumeRestOfLine().trim();
		const statements = this.parseUntilEnd();
		return { kind: "break", label, statements };
	}

	private parseRect(): RectStatement {
		this.consume("identifier", "rect");
		const color = this.consumeRestOfLine().trim();
		const statements = this.parseUntilEnd();
		return { kind: "rect", color, statements };
	}

	// ─── Group body parsers ───────────────────────────────────────────────

	private parseUntilEnd(): SequenceStatement[] {
		const stmts: SequenceStatement[] = [];
		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && t.value === "end") {
				this.consume();
				this.consumeIf("newline");
				break;
			}
			const stmt = this.parseStatement();
			if (stmt) stmts.push(stmt);
		}
		return stmts;
	}

	private parseUntilElseOrEnd(): SequenceStatement[] {
		const stmts: SequenceStatement[] = [];
		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && (t.value === "else" || t.value === "end"))
				break;
			const stmt = this.parseStatement();
			if (stmt) stmts.push(stmt);
		}
		return stmts;
	}

	private parseUntilAndOrEnd(): SequenceStatement[] {
		const stmts: SequenceStatement[] = [];
		while (!this.isAtEnd()) {
			this.skipTrivia();
			const t = this.peek();
			if (!t) break;
			if (t.type === "identifier" && (t.value === "and" || t.value === "end"))
				break;
			const stmt = this.parseStatement();
			if (stmt) stmts.push(stmt);
		}
		return stmts;
	}

	// ─── Helpers ──────────────────────────────────────────────────────────

	/**
	 * Consume tokens until newline and return the reconstructed text.
	 * Uses column positions to recover spaces and punctuation between tokens
	 * (which the tokenizer drops as unknown characters).
	 */
	private consumeRestOfLine(): string {
		const firstToken = this.peek();
		if (!firstToken || firstToken.type === "newline") {
			this.consumeIf("newline");
			return "";
		}

		// If we have the source line, read directly from it for faithful punctuation
		const sourceLine = this.sourceLines[firstToken.line - 1];
		if (sourceLine !== undefined) {
			// Consume all remaining tokens on this line
			const _lastCol = firstToken.col - 1; // 0-indexed
			while (true) {
				const t = this.peek();
				if (!t || t.type === "newline") break;
				this.consume();
			}
			this.consumeIf("newline");
			// Slice from the first token's column to end of line
			return sourceLine.slice(firstToken.col - 1).trim();
		}

		// Fallback: join token values with spaces
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

	private resolveArrow(raw: string): ArrowType {
		if (ARROW_PATTERNS.includes(raw as ArrowType)) return raw as ArrowType;
		return "-->";
	}

	private ensureParticipant(actor: string): void {
		if (!this.participantSet.has(actor)) {
			this.participantSet.add(actor);
			this.participants.push({ actor, kind: "participant" });
		}
	}
}
