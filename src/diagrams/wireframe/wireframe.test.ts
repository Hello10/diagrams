import { parse, render, toPlaintext } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import {
	clearWireframeLibraryAdapters,
	registerWireframeLibraryAdapter,
	renderWireframeAscii,
} from "./index.ts";
import type { WireframeAST, WireframeElementNode } from "./wireframeTypes.ts";

const BASIC_WIREFRAME = `wireframe
  use @hello10/diagrams/ui Stack, Text, Button, Input, Image, Table, Dialog
  use @app/components as App

  viewport mobile
  viewport desktop width=1024

  define ShowCard
    Stack gap=sm
      Image aspect=16:9
      Text $title weight=bold
      Button "Open" -->|call| onOpen
    end
  end

  define PaymentDialog
    Dialog "Confirm purchase"
      Text "You will be charged."
      Stack direction=row gap=sm justify=end
        Button "Cancel" -->|state| default
        Button "Pay" primary -->|call| onPay
      end
    end
  end

  screen Home
    Stack id=layout gap=lg
      App.Nav id=nav
        Text "Shows" size=lg weight=bold
        Button "Create" id=create -->|state| paying
      end
      Stack id=content
        Input id=search placeholder="Search shows"
        repeat ShowCard id=shows data=Show count=2 -->|call| onOpenShow
        Table id=showsTable data=Show columns="Title, Venue"
      end
    end

    state paying
      create disabled
      modal PaymentDialog id=payment
    end

    viewport desktop
      layout direction=row
      nav width=240
    end
  end
end`;

function errorsOf(src: string): string[] {
	const result = parse(src);
	if (result.ok) return [];
	return result.errors.map((e) => e.message);
}

function expectError(src: string, pattern: RegExp): void {
	const errors = errorsOf(src);
	expect(errors.length).toBeGreaterThan(0);
	expect(errors.some((m) => pattern.test(m))).toBe(true);
}

function screenOf(ast: WireframeAST, name: string): WireframeElementNode {
	const root = ast.elements[ast.root];
	for (const id of root?.children ?? []) {
		const node = ast.elements[id];
		if (node?.nodeKind === "screen" && node.screenName === name) return node;
	}
	throw new Error(`No screen ${name}`);
}

function byDeclaredId(ast: WireframeAST, id: string): WireframeElementNode {
	const hit = Object.values(ast.elements).find((n) => n.declaredId === id);
	if (!hit) throw new Error(`No element with id ${id}`);
	return hit;
}

beforeEach(() => {
	clearWireframeLibraryAdapters();
});

describe("wireframe language", () => {
	test("parses imports, viewports, defines, screens, states, and viewport blocks", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		expect(ast.type).toBe("wireframe");
		expect(ast.uses).toHaveLength(2);
		expect(ast.viewports).toEqual([
			{ name: "mobile", width: 390 },
			{ name: "desktop", width: 1024 },
		]);
		expect(Object.keys(ast.defines)).toEqual(["ShowCard", "PaymentDialog"]);
		expect(ast.defines.ShowCard?.params).toEqual(["title"]);
		expect(ast.defines.ShowCard?.hooks).toEqual(["onOpen"]);

		const home = screenOf(ast, "Home");
		expect(home.children).toHaveLength(1);
		expect(home.states?.map((s) => s.name)).toEqual(["paying"]);
		expect(home.viewportOverrides?.map((v) => v.viewport)).toEqual(["desktop"]);
		expect(home.hooks).toEqual(
			expect.arrayContaining(["onOpenShow", "onOpen", "onPay"]),
		);
	});

	test("Stack is built in and carries layout props", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const layout = byDeclaredId(ast, "layout");
		expect(layout.component).toEqual({
			kind: "named-import",
			module: "@hello10/diagrams/ui",
			name: "Stack",
		});
		expect(layout.attributes).toEqual({ gap: "lg" });
	});

	test("repeat shorthand normalizes to a wrapper with one bare child", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const shows = byDeclaredId(ast, "shows");
		expect(shows.nodeKind).toBe("repeat");
		expect(shows.data).toBe("Show");
		expect(shows.attributes.count).toBe("2");
		expect(shows.targetKind).toBe("call");
		expect(shows.children).toHaveLength(1);
		const child = ast.elements[shows.children?.[0] ?? ""];
		expect(child?.componentName).toBe("ShowCard");
		expect(child?.component).toEqual({ kind: "local", name: "ShowCard" });
	});

	test("repeat and modal accept a body instead of a reference", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Text, Button

  screen Home
    repeat id=rows count=4
      Text "Row"
      Button "Edit"
    end

    state editing
      modal id=editor
        Text "Edit row"
      end
    end
  end
end`),
		);
		const rows = byDeclaredId(ast, "rows");
		expect(rows.children).toHaveLength(2);
		const editor = byDeclaredId(ast, "editor");
		expect(editor.nodeKind).toBe("modal");
		expect(editor.children).toHaveLength(1);
		const state = screenOf(ast, "Home").states?.[0];
		expect(state?.children).toEqual([editor.id]);
	});

	test("state blocks record overrides and additions separately from the default tree", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const home = screenOf(ast, "Home");
		const paying = home.states?.[0];
		expect(paying?.overrides).toEqual([
			{ id: "create", attributes: {}, flags: ["disabled"], clearFlags: [] },
		]);
		expect(paying?.children).toHaveLength(1);
		const modal = ast.elements[paying?.children[0] ?? ""];
		expect(modal?.nodeKind).toBe("modal");
		expect(modal?.declaredId).toBe("payment");
		// The default tree does not include the modal.
		expect(home.children).not.toContain(modal?.id);
	});

	test("viewport blocks record layout overrides", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const desktop = screenOf(ast, "Home").viewportOverrides?.[0];
		expect(desktop?.overrides.map((o) => o.id)).toEqual(["layout", "nav"]);
		expect(desktop?.overrides[1]?.attributes).toEqual({ width: "240" });
	});

	test("-flag in an override clears a flag", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Save" id=save disabled
    state ready
      save -disabled primary
    end
  end
end`),
		);
		const ready = screenOf(ast, "Home").states?.[0];
		expect(ready?.overrides[0]).toEqual({
			id: "save",
			attributes: {},
			flags: ["primary"],
			clearFlags: ["disabled"],
		});
		const svg = render(ast);
		// The default frame dims the disabled button; the ready frame does not.
		const groups = svg.match(/<g data-id="save"[^>]*>/g) ?? [];
		expect(groups).toHaveLength(2);
		expect(groups[0]).toContain('opacity="0.45"');
		expect(groups[1]).not.toContain("opacity");
	});

	test("the same id may be declared in different screens", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Go" id=cta
  end
  screen Detail
    Button "Back" id=cta
  end
end`),
		);
		const ctas = Object.values(ast.elements).filter(
			(n) => n.declaredId === "cta",
		);
		expect(ctas).toHaveLength(2);
		expect(ctas.map((n) => n.content)).toEqual(["Go", "Back"]);
	});

	test("title, accTitle, and accDescr are captured and round-trip", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Text
  title Checkout
  accDescr: The checkout screens
  screen Home
    Text "Hi"
  end
end`),
		);
		expect(ast.title).toBe("Checkout");
		expect(ast.accDescr).toBe("The checkout screens");
		const again = assertOk<WireframeAST>(parse(toPlaintext(ast)));
		expect(again.title).toBe("Checkout");
	});
});

describe("wireframe validation", () => {
	test("rejects the bare id shorthand", () => {
		expectError(
			`wireframe
  use @app/components as App
  screen Home
    App.Chrome id
  end
end`,
			/id=name/,
		);
	});

	test("rejects a state bracket on the screen line", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Text
  screen Home [loading]
    Text "x"
  end
end`,
			/state loading … end/,
		);
	});

	test("rejects a viewport on the screen line", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Text
  screen Home mobile
    Text "x"
  end
end`,
			/viewport mobile/,
		);
	});

	test("rejects unknown state targets and undeclared viewports", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Go" -->|state| missing
  end
end`,
			/Unknown state "missing"/,
		);
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Go" id=go
    viewport desktop
      go width=100
    end
  end
end`,
			/Viewport "desktop" is not declared/,
		);
	});

	test("rejects components inside viewport blocks", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  viewport desktop
  screen Home
    Button "Go" id=go
    viewport desktop
      Button "Extra"
    end
  end
end`,
			/tree does not vary per viewport/,
		);
	});

	test("rejects overrides that match no id", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Go" id=go
    state busy
      nope disabled
    end
  end
end`,
			/Override "nope" in state busy/,
		);
	});

	test("rejects declaring the default state and duplicate states", () => {
		expectError(
			`wireframe
  screen Home
    state default
    end
  end
end`,
			/implicit base state/,
		);
		expectError(
			`wireframe
  screen Home
    state a
    end
    state a
    end
  end
end`,
			/Duplicate state "a"/,
		);
	});

	test("rejects duplicate ids within a screen", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "A" id=cta
    Button "B" id=cta
  end
end`,
			/Duplicate id "cta"/,
		);
	});

	test("rejects unresolved components and unknown namespaces", () => {
		expectError(
			`wireframe
  screen Home
    Widget
  end
end`,
			/Unresolved component "Widget"/,
		);
		expectError(
			`wireframe
  screen Home
    Button "Go"
  end
end`,
			/add `use @hello10\/diagrams\/ui Button`/,
		);
		expectError(
			`wireframe
  screen Home
    UI.Widget
  end
end`,
			/Unknown namespace "UI"/,
		);
	});

	test("rejects plain --> and raw @hook interactions", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Open" --> Detail
  end
end`,
			/Interactions need a kind/,
		);
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Open" @onOpen
  end
end`,
			/legacy wireframe syntax/,
		);
	});

	test("rejects repeat shorthand combined with a body", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Text
  define Card
    Text "x"
  end
  screen Home
    repeat Card
      Text "y"
    end
  end
end`,
			/shorthand for a single child/,
		);
	});

	test("rejects wireflow keywords, legacy keywords, and lowercase lines outside override blocks", () => {
		expectError(
			`wireframe
  screen Home
    ref Home
  end
end`,
			/belongs to wireflow/,
		);
		expectError(
			`wireframe
  screen Home
    list Card
  end
end`,
			/legacy wireframe syntax/,
		);
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Go" id=go
    go disabled
  end
end`,
			/only valid inside state and viewport blocks/,
		);
	});

	test("validates Stack enumerations and sizing values", () => {
		expectError(
			`wireframe
  use @hello10/diagrams/ui Stack
  screen Home
    Stack direction=diagonal
    end
  end
end`,
			/direction must be row or column/,
		);
		expectError(
			`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    Button "Go" width=wide
  end
end`,
			/width must be fill, hug, or a number/,
		);
	});

	test("rejects unknown viewports without a width", () => {
		expectError(
			`wireframe
  viewport watch
end`,
			/Unknown viewport "watch"/,
		);
	});
});

describe("wireframe round-trip", () => {
	test("toPlaintext re-parses to an equivalent AST and is stable", () => {
		const ast1 = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const text1 = toPlaintext(ast1);
		expect(text1).toContain("viewport desktop width=1024");
		expect(text1).toContain(
			"repeat ShowCard id=shows data=Show count=2 -->|call| onOpenShow",
		);
		expect(text1).toContain("modal PaymentDialog id=payment");
		expect(text1).toContain("      create disabled");
		expect(text1).toContain("      nav width=240");

		const ast2 = assertOk<WireframeAST>(parse(text1));
		expect(toPlaintext(ast2)).toBe(text1);
		expect(screenOf(ast2, "Home").states?.[0]?.overrides).toEqual(
			screenOf(ast1, "Home").states?.[0]?.overrides,
		);
	});

	test("repeat and modal bodies round-trip as blocks", () => {
		const src = `wireframe
  use @hello10/diagrams/ui Text, Button

  screen Home
    repeat id=rows count=4
      Text "Row"
      Button "Edit"
    end

    state editing
      modal id=editor
        Text "Edit row"
      end
    end
  end

end
`;
		const ast = assertOk<WireframeAST>(parse(src));
		expect(toPlaintext(ast)).toBe(src);
	});
});

describe("wireframe rendering", () => {
	test("renders one frame per screen state per viewport", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const svg = render(ast);
		expect(svg).toContain("<svg");
		const frames =
			svg.match(
				/<g data-screen="Home" data-state="[^"]+" data-viewport="[^"]+">/g,
			) ?? [];
		expect(frames).toHaveLength(4);
		expect(frames).toContain(
			'<g data-screen="Home" data-state="default" data-viewport="mobile">',
		);
		expect(frames).toContain(
			'<g data-screen="Home" data-state="paying" data-viewport="desktop">',
		);
	});

	test("draws modals only in the state that declares them, over a dimmed frame", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const svg = render(ast);
		const defaultMobile = svg.slice(
			svg.indexOf('data-state="default" data-viewport="mobile"'),
			svg.indexOf('data-state="default" data-viewport="desktop"'),
		);
		const payingMobile = svg.slice(
			svg.indexOf('data-state="paying" data-viewport="mobile"'),
			svg.indexOf('data-state="paying" data-viewport="desktop"'),
		);
		expect(defaultMobile).not.toContain("Confirm purchase");
		expect(payingMobile).toContain("Confirm purchase");
		expect(payingMobile).toContain("rgba(17, 24, 39, 0.45)");
		expect(payingMobile).toContain('filter="url(#wf-shadow)"');
	});

	test("honors Stack direction and fixed widths from viewport overrides", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const svg = render(ast);
		const desktop = svg.slice(
			svg.indexOf('data-state="default" data-viewport="desktop"'),
			svg.indexOf('data-state="paying" data-viewport="mobile"'),
		);
		const nav =
			/<g data-id="nav"[^>]*>\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/.exec(
				desktop,
			);
		expect(nav?.[3]).toBe("240");
		// Content sits to the right of the nav in a row layout.
		const content =
			/<g data-id="content"[^>]*>\s*<g data-id="search"[^>]*>\s*<rect x="([\d.]+)"/.exec(
				desktop,
			);
		expect(Number(content?.[1])).toBeGreaterThan(Number(nav?.[1]) + 240);
	});

	test("primary buttons keep their white label (no CSS fill override)", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const svg = render(ast);
		expect(svg).not.toMatch(/<style>[^<]*fill:/);
		expect(svg).toMatch(/fill="#ffffff" text-anchor="middle">Pay<\/text>/);
	});

	test("unmapped components render as a labeled box; hidden components are skipped", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Text
  use @app/components as App
  screen Home
    App.Chrome id=chrome
    Text "Gone" hidden
  end
end`),
		);
		const svg = render(ast);
		expect(svg).toContain("App.Chrome #chrome");
		expect(svg).toContain('stroke-dasharray="4,3"');
		expect(svg).not.toContain("Gone");
	});

	test("define params bind from use-site attributes and fall back to placeholders", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Text
  define Card
    Text $title
  end
  screen Home
    Card title="Hamilton"
    Card
  end
end`),
		);
		const svg = render(ast);
		expect(svg).toContain(">Hamilton</text>");
		expect(svg).toMatch(/font-style="italic">Title<\/text>/);
	});

	test("repeat unrolls to count copies", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Button
  screen Home
    repeat id=list count=4
      Button "Item"
    end
  end
end`),
		);
		const svg = render(ast);
		expect((svg.match(/>Item<\/text>/g) ?? []).length).toBe(4);
	});

	test("supports adapter-based custom SVG and ASCII rendering", () => {
		registerWireframeLibraryAdapter({
			module: "@app/components",
			components: {
				HeroMedia: {
					renderSvg: ({ x, y, width }) =>
						`<rect x="${x}" y="${y}" width="${width}" height="48" fill="white" stroke="#333"/><text x="${x + 8}" y="${y + 28}">Custom Hero</text>`,
					renderAscii: () => "custom hero renderer",
				},
			},
		});
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @app/components as App
  screen Home
    App.HeroMedia
  end
end`),
		);
		expect(render(ast)).toContain("Custom Hero");
		expect(renderWireframeAscii(ast)).toContain("custom hero renderer");
	});

	test("ASCII rendering walks the same expanded tree as the SVG", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const text = renderWireframeAscii(ast);
		expect(text).toContain("screen Home\n");
		expect(text).toContain("screen Home state paying");
		expect(text).toContain(
			"repeat x2 column #shows data=Show -->|call| onOpenShow",
		);
		expect(text).toContain('text "{Title}"');
		expect(text).toContain(
			"[button] Create #create (disabled) -->|state| paying",
		);
		expect(text).toContain("[dialog] Confirm purchase");
		expect(text).toContain("[table] Title | Venue #showsTable data=Show");
	});
});
