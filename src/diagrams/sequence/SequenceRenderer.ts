import { DiagramRenderer } from "../../DiagramRenderer.ts";
import {
	COLOR_ACTIVATION_FILL,
	COLOR_ACTIVATION_STROKE,
	COLOR_CHROME_MID,
	COLOR_COMPOUND_HEADER_FILL,
	COLOR_EDGE,
	COLOR_EDGE_DASHED,
	COLOR_SUBGRAPH_BORDER,
	FONT_SIZE_LABEL,
} from "../../style.ts";
import {
	arrowMarker,
	edgeLabel,
	estimateTextWidth,
	renderStickyNote,
	renderTitle,
	svgEsc,
} from "../../svg.ts";
import type {
	ActivationStatement,
	AltStatement,
	LoopStatement,
	MessageStatement,
	NoteStatement,
	ParStatement,
	SequenceDiagramAST,
	SequenceStatement,
} from "./sequenceTypes.ts";

// ─── Layout constants (diagram-specific) ────────────────────────────────────

const ACTOR_WIDTH = 100;
const ACTOR_HEIGHT = 40;
const ACTOR_SPACING = 160;
const LIFELINE_PADDING_TOP = 60;
const STMT_HEIGHT = 40;
const PADDING = 20;

const NOTE_MIN_WIDTH = 100;
const NOTE_LEFT_DISTANCE = 120; // left edge of a "left of" note from its actor's x
const NOTE_RIGHT_GAP = 20; // gap between actor x and left edge of a "right of" note
const NOTE_HORIZONTAL_PAD = 12;

const GROUP_HEADER = 24;
const GROUP_BOTTOM_PAD = 10;
const GROUP_GAP = 12; // space after each top-level / nested group, for visual separation
const GROUP_SIDE_PAD = 30; // horizontal padding from outermost participant to group rect edge
const BRANCH_HEADER = 18;

const ACTIVATION_WIDTH = 8;
const AUTONUMBER_RADIUS = 11;

interface BoundsAdjust {
	extraLeft: number;
	extraRight: number;
}

interface GroupBounds {
	left: number; // leftmost participant x referenced inside the group
	right: number; // rightmost participant x referenced inside the group
}
// ─── Render context ──────────────────────────────────────────────────────────

interface RenderCtx {
	actorX: Map<string, number>;
	parts: string[]; // foreground SVG elements
	backgroundParts: string[]; // emitted before lifelines (rect group fills)
	autonumberOn: boolean;
	autonumberCounter: number;
	activations: Map<string, ActivationBar[]>;
	svgWidth: number;
}

interface ActivationBar {
	startY: number;
	endY: number;
	depth: number;
}

// ─── Class entry point ──────────────────────────────────────────────────────

export class SequenceRenderer extends DiagramRenderer<SequenceDiagramAST> {
	private readonly actorX: Map<string, number>;
	private readonly bodyHeight: number;
	protected readonly lifelineTop: number;
	protected readonly lifelineBottom: number;
	protected readonly width: number;
	protected readonly height: number;

	constructor(ast: SequenceDiagramAST) {
		super(ast);
		const participants = ast.participants;
		this.actorX = new Map();
		const baseWidth = PADDING * 2 + participants.length * ACTOR_SPACING;
		participants.forEach((p, i) => {
			this.actorX.set(p.actor, PADDING + i * ACTOR_SPACING + ACTOR_WIDTH / 2);
		});

		const { extraLeft, extraRight } = this.computeBoundsAdjust(
			ast,
			this.actorX,
		);
		if (extraLeft > 0) {
			for (const [k, v] of this.actorX) this.actorX.set(k, v + extraLeft);
		}
		this.width = baseWidth + extraLeft + extraRight;
		this.bodyHeight = Math.max(
			this.sumHeights(ast.statements) + 40,
			STMT_HEIGHT,
		);
		this.lifelineTop = LIFELINE_PADDING_TOP + ACTOR_HEIGHT;
		this.lifelineBottom = this.lifelineTop + this.bodyHeight;
		this.height = this.lifelineTop + this.bodyHeight + ACTOR_HEIGHT + PADDING;
	}

	protected override renderDefs(): string {
		return arrowMarker("arr");
	}

	protected renderBody(): string {
		const ast = this.ast;
		const { actorX, width, lifelineTop, lifelineBottom } = this;
		const out: string[] = [];

		out.push(renderTitle(ast.title, width / 2, 20));

		const ctx: RenderCtx = {
			actorX,
			parts: [],
			backgroundParts: [],
			autonumberOn: false,
			autonumberCounter: 1,
			activations: new Map(),
			svgWidth: width,
		};

		let y = lifelineTop + 20;
		for (const stmt of ast.statements) {
			const h = this.renderStmt(stmt, ctx, y);
			y += h;
			if (this.isGroup(stmt)) y += GROUP_GAP;
		}

		out.push(...ctx.backgroundParts);

		for (const p of ast.participants) {
			const x = actorX.get(p.actor) ?? 0;
			out.push(
				`<line x1="${x}" y1="${lifelineTop}" x2="${x}" y2="${lifelineBottom}" stroke="${COLOR_EDGE_DASHED}" stroke-width="1" stroke-dasharray="4,4"/>`,
			);
		}

		out.push(...ctx.parts);

		for (const [actor, bars] of ctx.activations) {
			for (const bar of bars) {
				const x = actorX.get(actor);
				if (x === undefined) continue;
				const offset = bar.depth * (ACTIVATION_WIDTH / 2);
				const barHeight = Math.max(bar.endY - bar.startY, STMT_HEIGHT / 2);
				out.push(
					`<rect x="${x - ACTIVATION_WIDTH / 2 + offset}" y="${bar.startY}" width="${ACTIVATION_WIDTH}" height="${barHeight}" fill="${COLOR_ACTIVATION_FILL}" stroke="${COLOR_ACTIVATION_STROKE}" stroke-width="1"/>`,
				);
			}
		}

		for (const p of ast.participants) {
			const x = actorX.get(p.actor) ?? 0;
			const label = p.alias ?? p.actor;
			const boxX = x - ACTOR_WIDTH / 2;
			out.push(
				`<rect x="${boxX}" y="${LIFELINE_PADDING_TOP}" width="${ACTOR_WIDTH}" height="${ACTOR_HEIGHT}" fill="${COLOR_COMPOUND_HEADER_FILL}" stroke="${COLOR_COMPOUND_HEADER_FILL}" stroke-width="1"/>`,
				`<text x="${x}" y="${LIFELINE_PADDING_TOP + ACTOR_HEIGHT / 2 + 4}" text-anchor="middle" fill="white" font-weight="600">${svgEsc(label)}</text>`,
				`<rect x="${boxX}" y="${lifelineBottom}" width="${ACTOR_WIDTH}" height="${ACTOR_HEIGHT}" fill="${COLOR_COMPOUND_HEADER_FILL}" stroke="${COLOR_COMPOUND_HEADER_FILL}" stroke-width="1"/>`,
				`<text x="${x}" y="${lifelineBottom + ACTOR_HEIGHT / 2 + 4}" text-anchor="middle" fill="white" font-weight="600">${svgEsc(label)}</text>`,
			);
		}

		return out.join("\n");
	}

	toPlaintext(): string {
		const ast = this.ast;
		const lines: string[] = ["sequenceDiagram"];

		if (ast.title) lines.push(`  title ${ast.title}`);
		if (ast.accTitle) lines.push(`  accTitle: ${ast.accTitle}`);
		if (ast.accDescr) lines.push(`  accDescr: ${ast.accDescr}`);

		for (const p of ast.participants) {
			const alias = p.alias ? ` as ${p.alias}` : "";
			lines.push(`  ${p.kind} ${p.actor}${alias}`);
		}

		for (const stmt of ast.statements) {
			lines.push(...this.stmtToLines(stmt, "  "));
		}

		return lines.join("\n");
	}

	// ─── Layout helpers ──────────────────────────────────────────────────────────

	private measureStatement(stmt: SequenceStatement): number {
		switch (stmt.kind) {
			case "message":
			case "note":
				return STMT_HEIGHT;
			case "activation":
			case "autonumber":
				return 0;
			case "loop":
			case "break":
			case "rect":
				return (
					GROUP_HEADER + this.sumHeights(stmt.statements) + GROUP_BOTTOM_PAD
				);
			case "alt":
			case "par": {
				let inner = 0;
				stmt.branches.forEach((b, i) => {
					inner += i === 0 ? 0 : BRANCH_HEADER;
					inner += this.sumHeights(b.statements);
				});
				return GROUP_HEADER + inner + GROUP_BOTTOM_PAD;
			}
		}
	}

	private sumHeights(stmts: SequenceStatement[]): number {
		let total = 0;
		for (const s of stmts) {
			total += this.measureStatement(s);
			if (this.isGroup(s)) total += GROUP_GAP;
		}
		return total;
	}

	private isGroup(stmt: SequenceStatement): boolean {
		return (
			stmt.kind === "loop" ||
			stmt.kind === "break" ||
			stmt.kind === "rect" ||
			stmt.kind === "alt" ||
			stmt.kind === "par"
		);
	}

	private computeBoundsAdjust(
		ast: SequenceDiagramAST,
		actorX: Map<string, number>,
	): BoundsAdjust {
		const participants = ast.participants;
		const first = participants[0];
		const last = participants[participants.length - 1];
		if (!first || !last) return { extraLeft: 0, extraRight: 0 };

		const firstX = actorX.get(first.actor) ?? 0;
		const lastX = actorX.get(last.actor) ?? 0;
		const rightmostActorEdge = lastX + ACTOR_WIDTH / 2;
		const leftmostActorEdge = firstX - ACTOR_WIDTH / 2;

		let extraLeft = 0;
		let extraRight = 0;

		const visit = (stmts: SequenceStatement[]): void => {
			for (const stmt of stmts) {
				if (stmt.kind === "note") {
					const firstActor = stmt.actors[0];
					if (!firstActor) continue;
					const ax = actorX.get(firstActor) ?? 0;
					const w = this.noteWidth(stmt);
					if (stmt.position === "left of") {
						const noteLeftEdge =
							ax - NOTE_LEFT_DISTANCE - Math.max(0, w - NOTE_MIN_WIDTH);
						const need = leftmostActorEdge - noteLeftEdge + PADDING / 2;
						if (need > extraLeft) extraLeft = need;
					} else if (stmt.position === "right of") {
						const noteRightEdge = ax + NOTE_RIGHT_GAP + w;
						const need = noteRightEdge - rightmostActorEdge + PADDING / 2;
						if (need > extraRight) extraRight = need;
					}
				}
				if ("statements" in stmt) visit(stmt.statements);
				if ("branches" in stmt) {
					for (const b of stmt.branches) visit(b.statements);
				}
			}
		};

		visit(ast.statements);
		return {
			extraLeft: Math.max(0, extraLeft),
			extraRight: Math.max(0, extraRight),
		};
	}

	private noteWidth(stmt: NoteStatement): number {
		return Math.max(
			NOTE_MIN_WIDTH,
			Math.ceil(
				estimateTextWidth(stmt.text, FONT_SIZE_LABEL) + NOTE_HORIZONTAL_PAD * 2,
			),
		);
	}

	// ─── Group participant bounds ────────────────────────────────────────────────

	private groupParticipantBounds(
		stmts: SequenceStatement[],
		actorX: Map<string, number>,
	): GroupBounds | null {
		const xs: number[] = [];

		function collect(stmt: SequenceStatement): void {
			if (stmt.kind === "message") {
				const x1 = actorX.get(stmt.from);
				const x2 = actorX.get(stmt.to);
				if (x1 !== undefined) xs.push(x1);
				if (x2 !== undefined) xs.push(x2);
			} else if (stmt.kind === "note") {
				for (const actor of stmt.actors) {
					const x = actorX.get(actor);
					if (x !== undefined) xs.push(x);
				}
			} else if (stmt.kind === "activation") {
				const x = actorX.get(stmt.actor);
				if (x !== undefined) xs.push(x);
			} else if (
				stmt.kind === "loop" ||
				stmt.kind === "break" ||
				stmt.kind === "rect"
			) {
				for (const inner of stmt.statements) collect(inner);
			} else if (stmt.kind === "alt" || stmt.kind === "par") {
				for (const branch of stmt.branches) {
					for (const inner of branch.statements) collect(inner);
				}
			}
		}

		for (const s of stmts) collect(s);
		if (xs.length === 0) return null;
		return { left: Math.min(...xs), right: Math.max(...xs) };
	}

	// ─── Statement renderers ─────────────────────────────────────────────────────

	private renderStmt(
		stmt: SequenceStatement,
		ctx: RenderCtx,
		y: number,
	): number {
		switch (stmt.kind) {
			case "message":
				return this.renderMessage(stmt, ctx, y);
			case "note":
				return this.renderNote(stmt, ctx, y);
			case "activation":
				this.renderActivation(stmt, ctx, y);
				return 0;
			case "autonumber":
				ctx.autonumberOn = true;
				ctx.autonumberCounter = 1;
				return 0;
			case "loop":
			case "break":
				return this.renderLinearGroup(stmt, ctx, y);
			case "rect":
				return this.renderRectGroup(stmt, ctx, y);
			case "alt":
			case "par":
				return this.renderBranchedGroup(stmt, ctx, y);
		}
	}

	private renderMessage(
		stmt: MessageStatement,
		ctx: RenderCtx,
		y: number,
	): number {
		const x1 = ctx.actorX.get(stmt.from) ?? 0;
		const x2 = ctx.actorX.get(stmt.to) ?? 0;
		const arrowY = y + STMT_HEIGHT / 2;
		const isDashed = stmt.arrow.startsWith("--");
		const dashArray = isDashed ? 'stroke-dasharray="6,3"' : "";

		const showNumber = ctx.autonumberOn;
		const num = showNumber ? ctx.autonumberCounter++ : 0;

		if (x1 === x2) {
			// Self-message — small loop on the actor's lifeline
			const loopW = 32;
			const top = arrowY - 10;
			const bottom = arrowY + 10;
			ctx.parts.push(
				`<path d="M ${x1} ${top} L ${x1 + loopW} ${top} L ${x1 + loopW} ${bottom} L ${x1} ${bottom}" fill="none" stroke="${COLOR_EDGE}" stroke-width="1" ${dashArray} marker-end="url(#arr)"/>`,
				edgeLabel(x1 + loopW + 6, arrowY, stmt.label),
			);
			if (showNumber) this.emitAutonumber(ctx, x1, arrowY, num);
			return STMT_HEIGHT;
		}

		const direction = x2 > x1 ? 1 : -1;
		const startX = x1 + direction * (showNumber ? AUTONUMBER_RADIUS + 2 : 0);
		const endX = x2;
		// Center the label between the two participants regardless of where the
		// autonumber circle starts the visible line.
		const midX = (x1 + x2) / 2;

		ctx.parts.push(
			`<line x1="${startX}" y1="${arrowY}" x2="${endX}" y2="${arrowY}" stroke="${COLOR_EDGE}" stroke-width="1" ${dashArray} marker-end="url(#arr)"/>`,
			`<text x="${midX}" y="${arrowY - 5}" text-anchor="middle" font-size="11" fill="${COLOR_EDGE}">${svgEsc(stmt.label)}</text>`,
		);
		if (showNumber) this.emitAutonumber(ctx, x1, arrowY, num);
		return STMT_HEIGHT;
	}

	private emitAutonumber(
		ctx: RenderCtx,
		cx: number,
		cy: number,
		num: number,
	): void {
		ctx.parts.push(
			`<circle cx="${cx}" cy="${cy}" r="${AUTONUMBER_RADIUS}" fill="${COLOR_COMPOUND_HEADER_FILL}" stroke="white" stroke-width="2"/>`,
			`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="white" font-weight="bold">${num}</text>`,
		);
	}

	private renderNote(stmt: NoteStatement, ctx: RenderCtx, y: number): number {
		const firstActor = stmt.actors[0] ?? "";
		const actor1 = ctx.actorX.get(firstActor) ?? 0;
		const secondActor = stmt.actors[1];
		const actor2 = secondActor
			? (ctx.actorX.get(secondActor) ?? actor1)
			: actor1;
		const w = this.noteWidth(stmt);

		let nx: number;
		let nw: number;
		if (stmt.position === "over" && stmt.actors.length > 1) {
			const lo = Math.min(actor1, actor2) - 30;
			const hi = Math.max(actor1, actor2) + 30;
			nw = Math.max(hi - lo, w);
			nx = (actor1 + actor2) / 2 - nw / 2;
		} else if (stmt.position === "over") {
			nw = w;
			nx = actor1 - nw / 2;
		} else if (stmt.position === "left of") {
			nw = w;
			nx = actor1 - NOTE_LEFT_DISTANCE - Math.max(0, w - NOTE_MIN_WIDTH);
		} else {
			nw = w;
			nx = actor1 + NOTE_RIGHT_GAP;
		}

		const noteY = y + 4;
		const noteH = STMT_HEIGHT - 8;

		ctx.parts.push(
			renderStickyNote({
				x: nx,
				y: noteY,
				width: nw,
				height: noteH,
				text: stmt.text,
			}),
		);

		return STMT_HEIGHT;
	}

	private renderActivation(
		stmt: ActivationStatement,
		ctx: RenderCtx,
		y: number,
	): void {
		const existing = ctx.activations.get(stmt.actor) ?? [];
		if (stmt.active) {
			existing.push({ startY: y, endY: y, depth: existing.length });
		} else {
			for (let i = existing.length - 1; i >= 0; i--) {
				const bar = existing[i];
				if (bar && bar.endY === bar.startY) {
					bar.endY = y;
					break;
				}
			}
		}
		ctx.activations.set(stmt.actor, existing);
	}

	private groupRectExtents(
		stmts: SequenceStatement[],
		ctx: RenderCtx,
	): { x: number; width: number } {
		const bounds = this.groupParticipantBounds(stmts, ctx.actorX);
		if (!bounds) {
			return { x: 10, width: ctx.svgWidth - 20 };
		}
		const x = bounds.left - GROUP_SIDE_PAD;
		const right = bounds.right + GROUP_SIDE_PAD;
		return { x, width: right - x };
	}

	private renderLinearGroup(
		stmt:
			| LoopStatement
			| { kind: "break"; label: string; statements: SequenceStatement[] },
		ctx: RenderCtx,
		y: number,
	): number {
		const innerHeight = this.sumHeights(stmt.statements);
		const totalHeight = GROUP_HEADER + innerHeight + GROUP_BOTTOM_PAD;
		const { x, width } = this.groupRectExtents(stmt.statements, ctx);

		ctx.parts.push(
			`<rect x="${x}" y="${y}" width="${width}" height="${totalHeight}" fill="none" stroke="${COLOR_CHROME_MID}" stroke-width="1" stroke-dasharray="4,2"/>`,
			`<rect x="${x}" y="${y}" width="48" height="18" fill="${COLOR_CHROME_MID}"/>`,
			`<text x="${x + 24}" y="${y + 13}" text-anchor="middle" font-size="10" fill="white" font-weight="bold">${svgEsc(stmt.kind.toUpperCase())}</text>`,
			`<text x="${x + 56}" y="${y + 13}" font-size="11" font-weight="bold" fill="${COLOR_EDGE}">${svgEsc(stmt.label)}</text>`,
		);

		let innerY = y + GROUP_HEADER;
		for (const inner of stmt.statements) {
			const h = this.renderStmt(inner, ctx, innerY);
			innerY += h;
			if (this.isGroup(inner)) innerY += GROUP_GAP;
		}

		return totalHeight;
	}

	private renderRectGroup(
		stmt: { kind: "rect"; color: string; statements: SequenceStatement[] },
		ctx: RenderCtx,
		y: number,
	): number {
		const innerHeight = this.sumHeights(stmt.statements);
		const totalHeight = GROUP_HEADER / 2 + innerHeight + GROUP_BOTTOM_PAD;
		const { x, width } = this.groupRectExtents(stmt.statements, ctx);

		const fill = this.parseColorOrFallback(
			stmt.color,
			"rgba(220, 235, 250, 0.5)",
		);
		// Emitted to backgroundParts so it draws under the lifelines.
		ctx.backgroundParts.push(
			`<rect x="${x}" y="${y}" width="${width}" height="${totalHeight}" fill="${fill}" stroke="none"/>`,
		);

		let innerY = y + GROUP_HEADER / 2;
		for (const inner of stmt.statements) {
			const h = this.renderStmt(inner, ctx, innerY);
			innerY += h;
			if (this.isGroup(inner)) innerY += GROUP_GAP;
		}

		return totalHeight;
	}

	private renderBranchedGroup(
		stmt: AltStatement | ParStatement,
		ctx: RenderCtx,
		y: number,
	): number {
		const headerKeyword = stmt.kind === "alt" ? "alt" : "par";
		const branchKeyword = stmt.kind === "alt" ? "else" : "and";

		let innerHeight = 0;
		stmt.branches.forEach((b, i) => {
			innerHeight += i === 0 ? 0 : BRANCH_HEADER;
			innerHeight += this.sumHeights(b.statements);
		});
		const totalHeight = GROUP_HEADER + innerHeight + GROUP_BOTTOM_PAD;

		// Bounds over all branches' inner statements
		const allInner: SequenceStatement[] = [];
		for (const b of stmt.branches) allInner.push(...b.statements);
		const { x, width } = this.groupRectExtents(allInner, ctx);

		ctx.parts.push(
			`<rect x="${x}" y="${y}" width="${width}" height="${totalHeight}" fill="none" stroke="${COLOR_CHROME_MID}" stroke-width="1" stroke-dasharray="4,2"/>`,
		);

		let innerY = y + GROUP_HEADER;
		const branchLabels =
			stmt.kind === "alt"
				? stmt.branches.map((b) => b.condition)
				: stmt.branches.map((b) => b.label);
		const branchStatements = stmt.branches.map((b) => b.statements);
		branchStatements.forEach((statements, i) => {
			const branchLabel = branchLabels[i] ?? "";
			if (i === 0) {
				ctx.parts.push(
					`<rect x="${x}" y="${y}" width="48" height="18" fill="${COLOR_CHROME_MID}"/>`,
					`<text x="${x + 24}" y="${y + 13}" text-anchor="middle" font-size="10" fill="white" font-weight="bold">${svgEsc(headerKeyword.toUpperCase())}</text>`,
					`<text x="${x + 56}" y="${y + 13}" font-size="11" font-weight="bold" fill="${COLOR_EDGE}">${svgEsc(branchLabel)}</text>`,
				);
			} else {
				ctx.parts.push(
					`<line x1="${x}" y1="${innerY}" x2="${x + width}" y2="${innerY}" stroke="${COLOR_CHROME_MID}" stroke-width="1" stroke-dasharray="3,2"/>`,
					`<rect x="${x}" y="${innerY}" width="48" height="18" fill="${COLOR_SUBGRAPH_BORDER}"/>`,
					`<text x="${x + 24}" y="${innerY + 13}" text-anchor="middle" font-size="10" fill="white" font-weight="bold">${svgEsc(branchKeyword)}</text>`,
					`<text x="${x + 56}" y="${innerY + 13}" font-size="11" font-weight="bold" fill="${COLOR_EDGE}">${svgEsc(branchLabel)}</text>`,
				);
				innerY += BRANCH_HEADER;
			}

			for (const inner of statements) {
				const h = this.renderStmt(inner, ctx, innerY);
				innerY += h;
				if (this.isGroup(inner)) innerY += GROUP_GAP;
			}
		});

		return totalHeight;
	}

	// ─── toPlaintext helpers ─────────────────────────────────────────────────────

	private stmtToLines(stmt: SequenceStatement, indent: string): string[] {
		switch (stmt.kind) {
			case "message":
				return [
					`${indent}${stmt.from} ${stmt.arrow} ${stmt.to}: ${stmt.label}`,
				];
			case "note":
				return [
					`${indent}note ${stmt.position} ${stmt.actors.join(",")}: ${stmt.text}`,
				];
			case "activation":
				return [
					`${indent}${stmt.active ? "activate" : "deactivate"} ${stmt.actor}`,
				];
			case "autonumber":
				return [`${indent}autonumber`];
			case "loop": {
				const inner = stmt.statements.flatMap((s) =>
					this.stmtToLines(s, `${indent}  `),
				);
				return [`${indent}loop ${stmt.label}`, ...inner, `${indent}end`];
			}
			case "alt": {
				const out: string[] = [];
				stmt.branches.forEach((b, i) => {
					out.push(`${indent}${i === 0 ? "alt" : "else"} ${b.condition}`);
					out.push(
						...b.statements.flatMap((s) => this.stmtToLines(s, `${indent}  `)),
					);
				});
				out.push(`${indent}end`);
				return out;
			}
			case "par": {
				const out: string[] = [];
				stmt.branches.forEach((b, i) => {
					out.push(`${indent}${i === 0 ? "par" : "and"} ${b.label}`);
					out.push(
						...b.statements.flatMap((s) => this.stmtToLines(s, `${indent}  `)),
					);
				});
				out.push(`${indent}end`);
				return out;
			}
			case "break": {
				const inner = stmt.statements.flatMap((s) =>
					this.stmtToLines(s, `${indent}  `),
				);
				return [`${indent}break ${stmt.label}`, ...inner, `${indent}end`];
			}
			case "rect": {
				const inner = stmt.statements.flatMap((s) =>
					this.stmtToLines(s, `${indent}  `),
				);
				return [`${indent}rect ${stmt.color}`, ...inner, `${indent}end`];
			}
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────────

	private parseColorOrFallback(raw: string, fallback: string): string {
		const trimmed = raw.trim();
		if (
			trimmed.startsWith("rgb(") ||
			trimmed.startsWith("rgba(") ||
			trimmed.startsWith("#") ||
			/^[a-zA-Z]+$/.test(trimmed)
		) {
			return trimmed;
		}
		return fallback;
	}
}
