import type { DiagramAST } from "../../types.ts";

export type ClassDiagramAST = DiagramAST & {
	type: "classDiagram";
	direction: ClassDirection;
	classes: ClassNode[];
	relationships: ClassRelationship[];
	notes: ClassNote[];
	namespaces: ClassNamespace[];
};

/** Visual group of related classes. Renders as a compound container with a
 * header strip — the same shape used by flowchart subgraphs and state
 * compound substates. */
export type ClassNamespace = {
	id: string;
	label?: string;
	/** Class ids contained in this namespace. */
	children: string[];
};

export type ClassDirection = "TB" | "BT" | "LR" | "RL";

export type ClassNode = {
	id: string;
	label?: string;
	/** UML stereotype displayed in « » above the class name, e.g.
	 * `"interface"`, `"enumeration"`, `"abstract"`. */
	stereotype?: string;
	/** Generic type parameter — `T` for `class Repository~T~`. The class id
	 * stays the bare name (`Repository`) so per-reference instantiations
	 * (`Repository~Order~`) resolve to the same class. */
	typeParam?: string;
	members: ClassMember[];
};

/** A class-anchored or standalone note. `target` is set when the note is
 * attached to a specific class via `note for ClassName "..."`. */
export type ClassNote = {
	text: string;
	target?: string;
};

/** A field or method on a class. Slice 1 captures the raw textual form so we
 * can round-trip and render without over-modeling the type/parameter
 * grammar yet — later slices may split this into `field` vs `method`
 * variants. */
export type ClassMember = {
	visibility: ClassVisibility;
	/** Raw text after the visibility marker, e.g. `String name` or
	 * `submit() Confirmation`. */
	text: string;
	/** True when the trailing portion of `text` matches `name(...)` — the
	 * renderer uses this hint to right-align the return type for methods. */
	isMethod: boolean;
};

/** UML visibility markers. `none` covers members declared without an explicit
 * prefix (e.g. enumeration values). */
export type ClassVisibility =
	| "public"
	| "private"
	| "protected"
	| "package"
	| "none";

export type ClassRelationship = {
	from: string;
	to: string;
	kind: ClassRelationshipKind;
	label?: string;
	fromCardinality?: string;
	toCardinality?: string;
};

/** Each Mermaid arrow form maps to one relationship kind. Direction is
 * normalized so `A <|-- B` and `B --|> A` both produce
 * `kind: "inheritance"` with `from: B, to: A` (subclass → superclass). */
export type ClassRelationshipKind =
	| "inheritance" // A <|-- B (B inherits from A)
	| "composition" // A *-- B (A composes B)
	| "aggregation" // A o-- B (A aggregates B)
	| "association" // A --> B (A associates with B)
	| "association-und" // A -- B (undirected association)
	| "dependency" // A ..> B (A depends on B)
	| "realization" // A <|.. B (B realizes interface A)
	| "link"; // A .. B (dashed undirected link)
