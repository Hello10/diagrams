import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fromJSON, parse, render, toJSON } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import { parseUiApp, renderUiApp, renderUiFlow } from "./index.ts";
import { UiFlowRenderer } from "./UiFlowRenderer.ts";
import type { UiAppAST, UiAST } from "./uiTypes.ts";

const fixturesDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../examples/diagrams",
);

const STD = 'use "@hello10/diagrams/ui"';

/** The Gigs app split by capability, keyed the way the documents name
 * each other. */
function gigs(): Record<string, string> {
	return Object.fromEntries(
		["shell", "discovery", "tickets", "library", "account"].map((name) => [
			`${name}::ui`,
			readFileSync(resolve(fixturesDir, `ui/${name}.txt`), "utf8"),
		]),
	);
}

function messages(result: ReturnType<typeof parseUiApp>): string[] {
	return result.ok
		? (result.warnings ?? []).map((e) => `${e.module}: ${e.message}`)
		: result.errors.map((e) => `${e.severity} ${e.module}: ${e.message}`);
}

/** Two documents that import each other's screens. */
const A = `ui
  ${STD} Stack, Text, Button
  use "b::ui" Detail
  screen Home route=/
    Stack
      Text "home"
      Button "Open" $click => go Detail(id=1)
    end
  end
end`;
const B = `ui
  ${STD} Text, Link
  use "a::ui" Home
  screen Detail route=/d/:id
    Link "Back" to=Home
  end
end`;

describe("a set of documents", () => {
	test("the split Gigs app parses as a set, with one entry", () => {
		const result = parseUiApp({ documents: gigs() });
		expect(messages(result)).toEqual([]);
		const app = assertOk<UiAppAST>(result);
		expect(app.order).toEqual([
			"shell::ui",
			"discovery::ui",
			"tickets::ui",
			"library::ui",
			"account::ui",
		]);
		expect(app.entry).toEqual({ module: "discovery::ui", screen: "Search" });
		expect(app.documents["shell::ui"]?.module).toBe("shell::ui");
	});

	test("imports record what they resolved to, and refs carry the module", () => {
		const app = assertOk<UiAppAST>(parseUiApp({ documents: gigs() }));
		const library = app.documents["library::ui"] as UiAST;
		expect(library.imports.Band).toMatchObject({
			module: "discovery::ui",
			name: "Band",
			kind: "screen",
			route: "/bands/:id",
			routeParams: ["id"],
		});
		expect(library.imports.AppShell).toMatchObject({
			module: "shell::ui",
			kind: "layout",
			params: ["current"],
		});
		expect(library.imports.TicketRow).toMatchObject({
			module: "tickets::ui",
			kind: "component",
			params: ["ticket"],
		});
		const screen = library.components.Library;
		expect(screen?.usesLayout).toBe("AppShell");
		expect(screen?.usesLayoutModule).toBe("shell::ui");
		const instance = JSON.stringify(screen?.tree);
		expect(instance).toContain(
			'"ref":{"kind":"component","name":"TicketRow","module":"tickets::ui"}',
		);
	});

	test("the split app and the monolith declare the same things and draw the same flow", () => {
		const mono = assertOk<UiAST>(
			parse(readFileSync(resolve(fixturesDir, "ui.txt"), "utf8")),
		);
		const app = assertOk<UiAppAST>(parseUiApp({ documents: gigs() }));
		const docs = app.order.map((m) => app.documents[m] as UiAST);
		const declared = (ast: UiAST) =>
			ast.order.map((name) => {
				const c = ast.components[name];
				return `${c?.isLayout ? "layout" : c?.route !== undefined ? "screen" : "component"} ${name}${c?.route ? ` ${c.route}` : ""}`;
			});
		expect(docs.flatMap(declared).sort()).toEqual(declared(mono).sort());

		const edges = (flow: UiFlowRenderer) =>
			flow
				.transitions()
				.map((e) => `${e.from} → ${e.to} (${e.label})`)
				.sort();
		const lead = app.documents[app.entry?.module ?? ""] as UiAST;
		expect(edges(new UiFlowRenderer({ ast: lead, app }))).toEqual(
			edges(new UiFlowRenderer({ ast: mono })),
		);
	});

	test("the set renders one flow and a group per document, frames once each", () => {
		const app = assertOk<UiAppAST>(parseUiApp({ documents: gigs() }));
		const svg = renderUiApp(app);
		expect((svg.match(/>Flow<\/text>/g) ?? []).length).toBe(1);
		for (const module of app.order)
			expect(svg).toContain(`data-document="${module}"`);
		// Search draws inside the imported AppShell: the nav is in its frame.
		const search = svg.slice(
			svg.indexOf('data-frame="discovery::ui::Search"'),
			svg.indexOf('data-frame="discovery::ui::Band"'),
		);
		expect(search).toContain(">Library</text>");
		expect(search).toContain(">Search bands</text>");
		// TicketRow is drawn under tickets, where it is declared, labeled
		// with where it is first embedded: the Library screen, elsewhere.
		expect(
			(svg.match(/data-frame="tickets::ui::TicketRow"/g) ?? []).length,
		).toBeGreaterThan(0);
		expect(svg).toContain(">in library::ui Library @tickets</text>");
		// No stubs: every screen is in the set.
		expect(svg).not.toContain('data-stub="true"');
	});

	test("cycles between documents are fine; declaration order across them is free", () => {
		const forward = assertOk<UiAppAST>(
			parseUiApp({ documents: { "a::ui": A, "b::ui": B } }),
		);
		const backward = assertOk<UiAppAST>(
			parseUiApp({ documents: { "b::ui": B, "a::ui": A } }),
		);
		expect(forward.entry).toEqual({ module: "a::ui", screen: "Home" });
		expect(backward.entry).toEqual({ module: "a::ui", screen: "Home" });
		const svg = renderUiApp(forward);
		expect(svg).toContain('data-node="a::ui::Home"');
		expect(svg).toContain('data-node="b::ui::Detail"');
	});

	test("the set opens at exactly one screen", () => {
		const none = parseUiApp({
			documents: {
				"a::ui": A.replace("route=/", "route=/home"),
				"b::ui": B,
			},
		});
		expect(messages(none)).toContainEqual(
			"error a::ui: No screen has route=/ in any document; that is where the app opens",
		);
		const two = parseUiApp({
			documents: { "a::ui": A, "b::ui": B.replace("route=/d/:id", "route=/") },
		});
		expect(messages(two)).toContainEqual(
			"error a::ui: More than one screen has route=/ (a::ui Home, b::ui Detail); the app opens at one",
		);
	});

	test("an imported name must be declared; its arguments are checked as a local's are", () => {
		const missing = parseUiApp({
			documents: {
				"a::ui": A.replace("Detail\n", "Detail, Nope\n"),
				"b::ui": B,
			},
		});
		expect(messages(missing)).toContainEqual(
			'error a::ui: "b::ui" declares no Nope',
		);
		const badArgs = parseUiApp({
			documents: {
				"a::ui": A.replace("go Detail(id=1)", "go Detail"),
				"b::ui": B,
			},
		});
		expect(messages(badArgs)).toContainEqual(
			"error a::ui: Detail needs id: `Detail(id=…)`",
		);
		const wrongKind = parseUiApp({
			documents: {
				"a::ui": A.replace('      Text "home"', "      Detail"),
				"b::ui": B,
			},
		});
		expect(messages(wrongKind)).toContainEqual(
			'error a::ui: Detail is a screen of "b::ui"; only components go in a tree',
		);
	});

	test("a name both declared and imported is a duplicate", () => {
		const result = parseUiApp({
			documents: {
				"a::ui": A.replace(
					'use "b::ui" Detail',
					'use "b::ui" Detail\n  screen Detail route=/x\n    Text "x"\n  end',
				),
				"b::ui": B,
			},
		});
		expect(messages(result)).toContainEqual(
			'error a::ui: "Detail" is both imported and declared',
		);
	});

	test("the namespace form addresses imports as Alias.Name everywhere", () => {
		const shell = `ui
  ${STD} Stack, Text, Outlet, Button
  layout Shell
    Stack
      Text "chrome"
      Outlet
    end
  end
  component Card(item)
    Button "{item.name}" $click => $pick(item)
  end
end`;
		const home = `ui
  ${STD} Stack, Text
  use "shell::ui" as Shell
  screen Home route=/ layout=Shell.Shell
    Stack
      Shell.Card(item=thing) $pick(got) => go Shell.Home
    end
  end
end`;
		const result = parseUiApp({
			documents: { "shell::ui": shell, "home::ui": home },
		});
		// Shell.Home is not declared in shell; the rest resolves.
		expect(messages(result).sort()).toEqual([
			'error home::ui: "Shell.Home" is not declared',
			'error home::ui: "thing" is not supplied in Home: no parameter, route param, in, list item, or handler param provides "thing"',
		]);
		const fixed = assertOk<UiAppAST>(
			parseUiApp({
				documents: {
					"shell::ui": shell,
					"home::ui": home
						.replace("go Shell.Home", "go Home")
						.replace("item=thing", 'item="x"'),
				},
			}),
		);
		const doc = fixed.documents["home::ui"] as UiAST;
		expect(doc.imports["Shell.Shell"]?.kind).toBe("layout");
		expect(doc.imports["Shell.Card"]?.kind).toBe("component");
		expect(doc.components.Home?.usesLayout).toBe("Shell");
		expect(doc.components.Home?.usesLayoutModule).toBe("shell::ui");
		const svg = renderUiApp(fixed);
		const frame = svg.slice(svg.indexOf('data-frame="home::ui::Home"'));
		expect(frame).toContain(">chrome</text>");
	});

	test("a resolver supplies documents the set refers to but does not draw", () => {
		const result = parseUiApp({
			documents: { "a::ui": A },
			resolve: (module) => (module === "b::ui" ? B : undefined),
		});
		expect(messages(result)).toEqual([]);
		const app = assertOk<UiAppAST>(result);
		expect(app.order).toEqual(["a::ui"]);
		const svg = renderUiApp(app);
		expect(svg).toContain('data-node="b::ui::Detail" data-stub="true"');
		expect(svg).toContain(">b::ui</text>");
		// The resolved document's declaration is checked against.
		const bad = parseUiApp({
			documents: { "a::ui": A.replace("go Detail(id=1)", "go Detail(zip=1)") },
			resolve: () => B,
		});
		expect(messages(bad)).toContainEqual(
			'error a::ui: Detail has no route param "zip"',
		);
	});

	test("a document that is not ui, and errors that carry their module", () => {
		const result = parseUiApp({
			documents: { "a::ui": A, "b::ui": "flowchart LR\n  x --> y" },
		});
		expect(messages(result)).toContainEqual(
			'error b::ui: "b::ui" is not a ui document; its first line is "flowchart LR"',
		);
		expect(messages(result)).toContainEqual(
			'warning a::ui: "b::ui" is not a registered adapter or a document in this set; its names are accepted unchecked and draw as placeholders',
		);
	});

	test("the set AST is plain data", () => {
		const app = assertOk<UiAppAST>(parseUiApp({ documents: gigs() }));
		const again = fromJSON(toJSON(app)) as UiAppAST;
		expect(again).toEqual(app);
		expect(renderUiApp(again)).toContain('data-document="tickets::ui"');
	});
});

describe("a document on its own", () => {
	const discovery = () => gigs()["discovery::ui"] as string;

	test("imports from documents out of reach warn and are accepted unchecked", () => {
		const result = parse(discovery());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.warnings?.map((w) => w.message)).toEqual([
			'"shell::ui" is not a registered adapter or a document in this set; its names are accepted unchecked and draw as placeholders',
			'"tickets::ui" is not a registered adapter or a document in this set; its names are accepted unchecked and draw as placeholders',
		]);
		const ast = result.ast as UiAST;
		expect(ast.imports.Show).toEqual({
			module: "tickets::ui",
			name: "Show",
			kind: "unresolved",
			routeParams: [],
			params: [],
		});
		// An unresolved layout leaves the screen bare.
		expect(ast.components.Search?.usesLayout).toBeUndefined();
		// A go to an unresolved screen takes any arguments.
		expect(
			parse(discovery().replace("go Show(id=picked.id)", "go Show")).ok,
		).toBe(true);
	});

	test("the flow ends an edge to an imported screen at a stub", () => {
		const ast = assertOk<UiAST>(parse(discovery()));
		const svg = renderUiFlow(ast);
		expect(svg).toContain('data-node="tickets::ui::Show" data-stub="true"');
		expect(svg).toContain(">tickets::ui</text>");
		expect(
			new UiFlowRenderer({ ast }).transitions().filter((e) => e.to === "Show"),
		).toEqual([{ from: "Band", to: "Show", label: "open ShowRow" }]);
	});

	test("an imported component draws as a placeholder box", () => {
		const ast = assertOk<UiAST>(parse(gigs()["library::ui"] as string));
		const svg = render(ast);
		expect(svg).toContain(">tickets::ui TicketRow</text>");
		expect(svg).toContain(">discovery::ui BandResult</text>");
	});
});
