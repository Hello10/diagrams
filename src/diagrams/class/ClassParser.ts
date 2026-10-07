import { DiagramParser } from "../../DiagramParser.ts";
import type { ParseResult } from "../../types.ts";
import type {
	ClassDiagramAST,
	ClassDirection,
	ClassMember,
	ClassNamespace,
	ClassNode,
	ClassRelationship,
	ClassRelationshipKind,
	ClassVisibility,
} from "./classTypes.ts";

/** Slice 1 parser. Operates on source lines rather than the token stream
 * because class member text contains operators we don't fully tokenize yet
 * (`~T~` generics, `<<stereotype>>`). Tokens are still accepted for API
 * uniformity but only used to anchor errors. Later slices will add structured
 * parsing for the grammar inside member lines. */
export class ClassParser extends DiagramParser<ClassDiagramAST> {
	private rawLines: string[] = [];

	setSource(lines: string[]): void {
		this.rawLines = lines;
	}

	parse(): ParseResult<ClassDiagramAST> {
		const ast: ClassDiagramAST = {
			type: "classDiagram",
			direction: "TB",
			classes: [],
			relationships: [],
			notes: [],
			namespaces: [],
		};

		const classes = new Map<string, ClassNode>();
		const getOrCreate = (id: string): ClassNode => {
			let cls = classes.get(id);
			if (!cls) {
				cls = { id, members: [] };
				classes.set(id, cls);
				ast.classes.push(cls);
			}
			return cls;
		};

		// Track membership when a class is declared inside a namespace block.
		let currentNamespace: ClassNamespace | null = null;
		const recordChild = (classId: string) => {
			if (!currentNamespace) return;
			if (!currentNamespace.children.includes(classId)) {
				currentNamespace.children.push(classId);
			}
		};

		let inBody: { node: ClassNode } | null = null;

		for (let i = 0; i < this.rawLines.length; i++) {
			const rawLine = this.rawLines[i] ?? "";
			const line = rawLine.trim();
			const lineNum = i + 1;

			// Skip blank / comment / frontmatter lines outside and inside body.
			if (line === "" || line.startsWith("%%") || line.startsWith("---")) {
				continue;
			}

			// Inside a class body: every line is a member until we see `}`.
			if (inBody) {
				if (line === "}") {
					inBody = null;
					continue;
				}
				// Stereotype line — set on the parent class instead of treating
				// as a member row.
				const stereotype = this.matchStereotype(line);
				if (stereotype !== undefined) {
					inBody.node.stereotype = stereotype;
					continue;
				}
				const member = this.parseMember(line);
				if (member) inBody.node.members.push(member);
				continue;
			}

			// Header line — accept `classDiagram` (case-insensitive) or short
			// alias `class`. The diagram dispatcher already detected this; we
			// just skip past it here.
			const lower = line.toLowerCase();
			if (lower === "classdiagram" || lower === "class") {
				continue;
			}

			// Namespace open: `namespace Foo {` or `namespace Foo[Label] {`.
			if (lower.startsWith("namespace ")) {
				const rest = line.slice("namespace ".length).trim();
				const openBrace = rest.indexOf("{");
				const decl = openBrace >= 0 ? rest.slice(0, openBrace).trim() : rest;
				const labelMatch = /^([A-Za-z_$][\w$.]*)(?:\[([^\]]*)\])?$/.exec(decl);
				if (!labelMatch?.[1]) {
					this.errorAt("Namespace declaration missing name", lineNum);
					continue;
				}
				if (currentNamespace) {
					this.warnAt(
						"Nested namespaces are not yet supported; flattening",
						lineNum,
					);
				}
				currentNamespace = {
					id: labelMatch[1],
					children: [],
				};
				if (labelMatch[2]) currentNamespace.label = labelMatch[2];
				ast.namespaces.push(currentNamespace);
				continue;
			}

			// Namespace close: a `}` outside a class body closes the current
			// namespace (if any). When no namespace is active, fall through to
			// the unrecognized-line warning.
			if (line === "}" && currentNamespace) {
				currentNamespace = null;
				continue;
			}

			// Meta directives.
			if (lower.startsWith("direction ")) {
				const dir = line.slice("direction ".length).trim().toUpperCase();
				if (
					dir === "TB" ||
					dir === "BT" ||
					dir === "LR" ||
					dir === "RL" ||
					dir === "TD"
				) {
					ast.direction = (dir === "TD" ? "TB" : dir) as ClassDirection;
				} else {
					this.warnAt(`Unknown direction "${dir}"`, lineNum);
				}
				continue;
			}
			if (lower.startsWith("title ")) {
				ast.title = line.slice("title ".length).trim();
				continue;
			}
			if (lower.startsWith("acctitle:")) {
				ast.accTitle = line.slice("acctitle:".length).trim();
				continue;
			}
			if (lower.startsWith("accdescr:")) {
				ast.accDescr = line.slice("accdescr:".length).trim();
				continue;
			}

			// Class declaration: `class Name` or `class Name { ...` (opens body).
			if (lower.startsWith("class ")) {
				const rest = line.slice("class ".length).trim();
				const openBrace = rest.indexOf("{");
				const namePart =
					openBrace >= 0 ? rest.slice(0, openBrace).trim() : rest;
				const { id, typeParam } = stripTypeParam(namePart);
				if (!id) {
					this.errorAt("Class declaration missing name", lineNum);
					continue;
				}
				const node = getOrCreate(id);
				if (typeParam !== undefined) node.typeParam = typeParam;
				recordChild(node.id);
				if (openBrace >= 0) {
					inBody = { node };
					// Allow `class Foo { +x: int }` on one line — parse what's
					// after `{` up to `}` as inline body.
					const inline = rest.slice(openBrace + 1).trim();
					if (inline.endsWith("}")) {
						const inner = inline.slice(0, -1).trim();
						if (inner) {
							const m = this.parseMember(inner);
							if (m) node.members.push(m);
						}
						inBody = null;
					} else if (inline) {
						const m = this.parseMember(inline);
						if (m) node.members.push(m);
					}
				}
				continue;
			}

			// Notes: `note for ClassName "text"` or standalone `note "text"`.
			if (lower.startsWith("note ")) {
				const note = this.parseNote(line);
				if (note) {
					ast.notes.push(note);
					continue;
				}
			}

			// Shorthand member: `ClassName : memberText`. Must come before
			// the relationship check because a relationship's optional label
			// also uses `:`.
			if (this.looksLikeShorthandMember(line)) {
				const colon = line.indexOf(":");
				const cls = getOrCreate(line.slice(0, colon).trim());
				const member = this.parseMember(line.slice(colon + 1).trim());
				if (member) cls.members.push(member);
				continue;
			}

			// Relationship line.
			const rel = this.parseRelationship(line, lineNum);
			if (rel) {
				// Ensure both classes are registered, even if not declared
				// explicitly elsewhere (matches Mermaid's behaviour).
				getOrCreate(rel.from);
				getOrCreate(rel.to);
				ast.relationships.push(rel);
				continue;
			}

			// Unknown line — record a warning so the user knows it was
			// ignored, but don't fail the parse.
			this.warnAt(`Unrecognized line: "${line}"`, lineNum);
		}

		return this.result(ast);
	}

	// ─── Member parsing ──────────────────────────────────────────────────────

	private parseMember(text: string): ClassMember | undefined {
		if (!text) return undefined;
		// Stereotypes are handled at the class-body level — don't double-emit
		// them as members.
		if (this.matchStereotype(text) !== undefined) return undefined;
		let visibility: ClassVisibility = "none";
		let rest = text;
		const first = text[0];
		if (first === "+") visibility = "public";
		else if (first === "-") visibility = "private";
		else if (first === "#") visibility = "protected";
		else if (first === "~") visibility = "package";
		if (visibility !== "none") rest = text.slice(1).trim();
		const isMethod = /\(.*\)/.test(rest);
		return { visibility, text: rest, isMethod };
	}

	/** Recognize a `<<stereotype>>` line and return the bare label, or
	 * undefined if `text` is not in that form. */
	private matchStereotype(text: string): string | undefined {
		if (text.startsWith("<<") && text.endsWith(">>") && text.length >= 4) {
			return text.slice(2, -2).trim();
		}
		return undefined;
	}

	/** Parse a `note for ClassName "..."` or `note "..."` line. */
	private parseNote(
		line: string,
	): { text: string; target?: string } | undefined {
		const m =
			/^note\s+for\s+([A-Za-z_$][\w$.]*)\s+"([^"]*)"\s*$/.exec(line) ??
			/^note\s+"([^"]*)"\s*$/.exec(line);
		if (!m) return undefined;
		if (m.length === 3 && m[1] && m[2] !== undefined) {
			return { target: m[1], text: m[2] };
		}
		if (m.length === 2 && m[1] !== undefined) {
			return { text: m[1] };
		}
		return undefined;
	}

	private looksLikeShorthandMember(line: string): boolean {
		// `ClassName : something` where the LHS is a single identifier and the
		// RHS doesn't look like a relationship label (no arrow on the line).
		const colon = line.indexOf(":");
		if (colon <= 0) return false;
		const lhs = line.slice(0, colon).trim();
		if (!/^[A-Za-z_$][\w$.]*$/.test(lhs)) return false;
		// If the line contains a relationship arrow before the colon, this is
		// a relationship-with-label rather than shorthand.
		const beforeColon = line.slice(0, colon);
		if (this.findArrow(beforeColon)) return false;
		return true;
	}

	// ─── Relationship parsing ────────────────────────────────────────────────

	/** Arrow forms recognized by the class diagram, longest-first so the
	 * scanner picks the most specific match. Each maps to a relationship
	 * kind plus a direction flag — when `reversed` is true the source/target
	 * positions in the text are swapped to normalise the AST. */
	private static readonly ARROW_TABLE: Array<{
		token: string;
		kind: ClassRelationshipKind;
		reversed: boolean;
	}> = [
		{ token: "<|--", kind: "inheritance", reversed: true },
		{ token: "--|>", kind: "inheritance", reversed: false },
		{ token: "<|..", kind: "realization", reversed: true },
		{ token: "..|>", kind: "realization", reversed: false },
		{ token: "*--", kind: "composition", reversed: false },
		{ token: "--*", kind: "composition", reversed: true },
		{ token: "o--", kind: "aggregation", reversed: false },
		{ token: "--o", kind: "aggregation", reversed: true },
		{ token: "<..", kind: "dependency", reversed: true },
		{ token: "..>", kind: "dependency", reversed: false },
		{ token: "<--", kind: "association", reversed: true },
		{ token: "-->", kind: "association", reversed: false },
		{ token: "--", kind: "association-und", reversed: false },
		{ token: "..", kind: "link", reversed: false },
	];

	private findArrow(segment: string):
		| {
				index: number;
				token: string;
				kind: ClassRelationshipKind;
				reversed: boolean;
		  }
		| undefined {
		for (const entry of ClassParser.ARROW_TABLE) {
			// Require whitespace (or string edge) on at least one side so
			// `..` inside `List..xs` style identifiers doesn't accidentally
			// match. Class fixtures always space their arrows.
			const idx = segment.indexOf(` ${entry.token} `);
			if (idx >= 0) {
				return {
					index: idx + 1,
					token: entry.token,
					kind: entry.kind,
					reversed: entry.reversed,
				};
			}
		}
		return undefined;
	}

	private parseRelationship(
		line: string,
		lineNum: number,
	): ClassRelationship | undefined {
		const arrow = this.findArrow(line);
		if (!arrow) return undefined;

		const left = line.slice(0, arrow.index).trim();
		const right = line.slice(arrow.index + arrow.token.length).trim();

		// Pull an optional `: label` off the right side.
		const colon = this.findRelationshipColon(right);
		const targetPart = colon >= 0 ? right.slice(0, colon).trim() : right;
		const label = colon >= 0 ? right.slice(colon + 1).trim() : undefined;

		const leftEnd = this.splitIdAndCardinality(left, "right");
		const rightEnd = this.splitIdAndCardinality(targetPart, "left");

		if (!leftEnd.id || !rightEnd.id) {
			this.errorAt(`Could not parse relationship: "${line}"`, lineNum);
			return undefined;
		}

		const fromId = arrow.reversed ? rightEnd.id : leftEnd.id;
		const toId = arrow.reversed ? leftEnd.id : rightEnd.id;
		const fromCard = arrow.reversed
			? rightEnd.cardinality
			: leftEnd.cardinality;
		const toCard = arrow.reversed ? leftEnd.cardinality : rightEnd.cardinality;

		const rel: ClassRelationship = {
			from: fromId,
			to: toId,
			kind: arrow.kind,
		};
		if (label) rel.label = label;
		if (fromCard) rel.fromCardinality = fromCard;
		if (toCard) rel.toCardinality = toCard;
		return rel;
	}

	/** Split an endpoint segment (one side of the arrow) into the class id
	 * and an optional cardinality string. `side` indicates whether the
	 * cardinality is expected on the inner side (toward the arrow) — the
	 * cardinality always sits between the id and the arrow regardless of
	 * which side of the line we're looking at, so the search direction
	 * differs per side. */
	private splitIdAndCardinality(
		segment: string,
		_side: "left" | "right",
	): { id: string; cardinality?: string } {
		// Allow `~` and `~...~` in the identifier match so generic
		// instantiations like `Repository~Order~` parse, then strip the
		// generic suffix to land on the canonical class id.
		const m = segment.match(
			/^(?:([A-Za-z_$][\w$.~]*)\s+"([^"]*)"|"([^"]*)"\s+([A-Za-z_$][\w$.~]*)|([A-Za-z_$][\w$.~]*))\s*$/,
		);
		const normalise = (raw: string) => stripTypeParam(raw).id;
		if (!m) return { id: normalise(segment.trim()) };
		if (m[1] && m[2] !== undefined)
			return { id: normalise(m[1]), cardinality: m[2] };
		if (m[4] && m[3] !== undefined)
			return { id: normalise(m[4]), cardinality: m[3] };
		if (m[5]) return { id: normalise(m[5]) };
		return { id: normalise(segment.trim()) };
	}

	/** Find the index of a top-level `:` separator (the relationship label
	 * separator), ignoring colons inside quoted strings. */
	private findRelationshipColon(s: string): number {
		let inQuote = false;
		for (let i = 0; i < s.length; i++) {
			const ch = s[i];
			if (ch === '"') inQuote = !inQuote;
			else if (ch === ":" && !inQuote) return i;
		}
		return -1;
	}

	// ─── Error helpers that don't require a token ────────────────────────────

	private errorAt(message: string, line: number): void {
		this.errors.push({ message, line, col: 1, severity: "error" });
	}

	private warnAt(message: string, line: number): void {
		this.errors.push({ message, line, col: 1, severity: "warning" });
	}
}

/** Split `Name~T~` into `{ id: "Name", typeParam: "T" }`. When no
 * `~...~` suffix is present `typeParam` is undefined and `id` is the input
 * unchanged. Used both on class declarations and on per-reference
 * instantiations in relationship endpoints. */
export function stripTypeParam(name: string): {
	id: string;
	typeParam?: string;
} {
	const m = /^([A-Za-z_$][\w$.]*)~([^~]+)~$/.exec(name.trim());
	if (!m?.[1]) return { id: name.trim() };
	return { id: m[1], typeParam: m[2] };
}
