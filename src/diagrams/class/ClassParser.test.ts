import { parse, render, toPlaintext } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import type { ClassDiagramAST } from "./classTypes.ts";

describe("classDiagram detect()", () => {
	test("detects `classDiagram` and short-form `class`", () => {
		const a = parse("classDiagram\n  class Foo");
		expect(a.ok).toBe(true);
		const b = parse("class\n  class Foo");
		expect(b.ok).toBe(true);
	});
});

describe("class declarations", () => {
	test("bare class declaration with no body", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Animal`),
		);
		expect(ast.classes).toHaveLength(1);
		expect(ast.classes[0]?.id).toBe("Animal");
		expect(ast.classes[0]?.members).toHaveLength(0);
	});

	test("class body captures members with each visibility marker", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Order {
    +UUID id
    -List items
    #log event
    ~normalize
  }`),
		);
		const order = ast.classes.find((c) => c.id === "Order");
		expect(order?.members.map((m) => m.visibility)).toEqual([
			"public",
			"private",
			"protected",
			"package",
		]);
		expect(order?.members.map((m) => m.text)).toEqual([
			"UUID id",
			"List items",
			"log event",
			"normalize",
		]);
	});

	test("isMethod flag is set when text contains parens", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Foo {
    +submit() bool
    +value int
  }`),
		);
		const members = ast.classes[0]?.members ?? [];
		expect(members[0]?.isMethod).toBe(true);
		expect(members[1]?.isMethod).toBe(false);
	});

	test("shorthand `ClassName : member` syntax", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Order
  Order : +UUID id
  Order : +submit()`),
		);
		const order = ast.classes.find((c) => c.id === "Order");
		expect(order?.members).toHaveLength(2);
		expect(order?.members[0]?.text).toBe("UUID id");
		expect(order?.members[1]?.isMethod).toBe(true);
	});
});

describe("relationships", () => {
	const src = `classDiagram
  class A
  class B
  A <|-- B
  A --|> B
  A *-- B
  A o-- B
  A --> B
  A <-- B
  A -- B
  A ..> B
  A <.. B
  A ..|> B
  A <|.. B
  A .. B`;

	test("each arrow form maps to the right kind, normalised direction", () => {
		const ast = assertOk<ClassDiagramAST>(parse(src));
		const kinds = ast.relationships.map((r) => `${r.from}-${r.kind}-${r.to}`);
		expect(kinds).toEqual([
			"B-inheritance-A", // A <|-- B reversed
			"A-inheritance-B", // A --|> B
			"A-composition-B",
			"A-aggregation-B",
			"A-association-B",
			"B-association-A", // A <-- B reversed
			"A-association-und-B",
			"A-dependency-B",
			"B-dependency-A", // A <.. B reversed
			"A-realization-B",
			"B-realization-A", // A <|.. B reversed
			"A-link-B",
		]);
	});

	test("cardinality strings on both ends + edge label", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  Order "1" *-- "1..*" LineItem : contains`),
		);
		const rel = ast.relationships[0];
		expect(rel?.from).toBe("Order");
		expect(rel?.to).toBe("LineItem");
		expect(rel?.fromCardinality).toBe("1");
		expect(rel?.toCardinality).toBe("1..*");
		expect(rel?.label).toBe("contains");
	});

	test("cardinalities follow the source/target after a reversed arrow", () => {
		// Mermaid: in `A "1" <|-- "*" B`, B inherits from A.
		// Our normalised AST: from=B (subclass), to=A (superclass),
		// fromCardinality="*", toCardinality="1".
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  Animal "1" <|-- "*" Dog`),
		);
		const rel = ast.relationships[0];
		expect(rel?.from).toBe("Dog");
		expect(rel?.to).toBe("Animal");
		expect(rel?.fromCardinality).toBe("*");
		expect(rel?.toCardinality).toBe("1");
	});

	test("classes mentioned only in relationships are registered", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  A --> B`),
		);
		const ids = ast.classes.map((c) => c.id).sort();
		expect(ids).toEqual(["A", "B"]);
	});
});

describe("slice 2: generics, stereotypes, notes", () => {
	test("generic class declaration sets typeParam, id stays bare", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Repository~T~ {
    +find(id) T
  }`),
		);
		expect(ast.classes[0]?.id).toBe("Repository");
		expect(ast.classes[0]?.typeParam).toBe("T");
	});

	test("generic instantiation in relationships resolves to canonical id", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Repository~T~
  class OrderRepository
  Repository~Order~ <|.. OrderRepository`),
		);
		const rel = ast.relationships[0];
		// Reversed arrow: from = OrderRepository, to = Repository (canonical id,
		// without the ~Order~ instantiation suffix).
		expect(rel?.from).toBe("OrderRepository");
		expect(rel?.to).toBe("Repository");
	});

	test("stereotype line in body sets node.stereotype, not a member", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class PaymentMethod {
    <<interface>>
    +charge(amount) Receipt
  }`),
		);
		const node = ast.classes[0];
		expect(node?.stereotype).toBe("interface");
		expect(node?.members).toHaveLength(1);
		expect(node?.members[0]?.text).toBe("charge(amount) Receipt");
	});

	test("note for ClassName and standalone note are captured", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  class Order
  note for Order "Aggregate root."
  note "Domain model spans @app/domain."`),
		);
		expect(ast.notes).toEqual([
			{ target: "Order", text: "Aggregate root." },
			{ text: "Domain model spans @app/domain." },
		]);
	});

	test("round-trip preserves stereotype, typeParam, and notes", () => {
		const src = `classDiagram
  class Repository~T~ {
    <<interface>>
    +find(id) T
  }
  class OrderRepository
  Repository <|.. OrderRepository
  note for Repository "Generic data store"`;
		const ast1 = assertOk<ClassDiagramAST>(parse(src));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<ClassDiagramAST>(parse(text));
		expect(ast2.classes.find((c) => c.id === "Repository")?.typeParam).toBe(
			"T",
		);
		expect(ast2.classes.find((c) => c.id === "Repository")?.stereotype).toBe(
			"interface",
		);
		expect(ast2.notes).toHaveLength(1);
		expect(ast2.notes[0]?.target).toBe("Repository");
	});

	test("rendered SVG includes stereotype, generic decoration, and note text", () => {
		const src = `classDiagram
  class Repository~T~ {
    <<interface>>
    +find(id) T
  }
  class OrderRepository
  note for OrderRepository "Persists Orders"`;
		const ast = assertOk<ClassDiagramAST>(parse(src));
		const svg = render(ast);
		// Mermaid-style generic decoration becomes <T> in display.
		expect(svg).toContain("Repository&lt;T&gt;");
		expect(svg).toContain("«interface»");
		expect(svg).toContain("Persists Orders");
	});
});

describe("slice 3: namespaces", () => {
	test("namespace block records its children", () => {
		const ast = assertOk<ClassDiagramAST>(
			parse(`classDiagram
  namespace Catalog {
    class Product
    class Category
  }
  class Customer`),
		);
		expect(ast.namespaces).toHaveLength(1);
		expect(ast.namespaces[0]?.id).toBe("Catalog");
		expect(ast.namespaces[0]?.children).toEqual(["Product", "Category"]);
		// Customer is outside any namespace.
		expect(ast.classes.find((c) => c.id === "Customer")).toBeDefined();
	});

	test("cross-namespace relationship is rendered + ranking still works", () => {
		const src = `classDiagram
  namespace Catalog {
    class Product
  }
  namespace Ordering {
    class LineItem
  }
  LineItem --> Product`;
		const ast = assertOk<ClassDiagramAST>(parse(src));
		expect(ast.relationships).toHaveLength(1);
		const svg = render(ast);
		expect(svg).toContain("Catalog");
		expect(svg).toContain("Ordering");
		expect(svg).toContain("Product");
		expect(svg).toContain("LineItem");
	});

	test("toPlaintext round-trips namespaces", () => {
		const src = `classDiagram
  namespace Catalog {
    class Product
    class Category
  }
  Product --> Category`;
		const ast1 = assertOk<ClassDiagramAST>(parse(src));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<ClassDiagramAST>(parse(text));
		expect(ast2.namespaces).toHaveLength(1);
		expect(ast2.namespaces[0]?.children.sort()).toEqual([
			"Category",
			"Product",
		]);
	});
});

describe("rendering + round-trip (slice 1)", () => {
	const src = `classDiagram
  class Order {
    +UUID id
    +submit() bool
  }
  class LineItem {
    +int quantity
  }
  Order "1" *-- "1..*" LineItem : contains`;

	test("renders to an SVG envelope", () => {
		const ast = assertOk<ClassDiagramAST>(parse(src));
		const svg = render(ast);
		expect(svg).toMatch(/^<svg/);
		expect(svg).toContain("</svg>");
		expect(svg).toContain("Order");
		expect(svg).toContain("LineItem");
		expect(svg).toContain("submit() bool");
	});

	test("toPlaintext round-trips classes + relationships", () => {
		const ast1 = assertOk<ClassDiagramAST>(parse(src));
		const text = toPlaintext(ast1);
		const ast2 = assertOk<ClassDiagramAST>(parse(text));
		expect(ast2.classes.map((c) => c.id).sort()).toEqual(["LineItem", "Order"]);
		expect(ast2.relationships).toHaveLength(1);
		expect(ast2.relationships[0]?.label).toBe("contains");
		expect(ast2.relationships[0]?.fromCardinality).toBe("1");
		expect(ast2.relationships[0]?.toCardinality).toBe("1..*");
	});
});
