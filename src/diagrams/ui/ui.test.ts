import { parse, render, toPlaintext } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import {
	clearUiLibraryAdapters,
	registerUiLibraryAdapter,
	renderUiAscii,
	renderUiFlow,
} from "./index.ts";
import type { UiAST } from "./uiTypes.ts";

const STD = 'use "@hello10/diagrams/ui"';
const API = 'api "@test/api"';

const BASIC = `ui
  ${STD} Stack, Heading, Text, Input, Button, Image, Audio
  ${API} results, band, albums, tracks

  screen Search route=/
    in ~results(query=#query.value)

    Stack
      Input #query placeholder="Search bands"
      list results as band
        BandResult(band) $open(picked) => go Band(id=picked.id)
      end
      when
        ~results.empty => Text "No bands match."
      end
    end
  end

  screen Band route=/bands/:id @browsing @listening(current)
    in ~band(id)
    in ~albums(id)

    Stack
      when
        ~band.loading => Text "Loading…"
        ~band.error   => Text "Could not load this band."
      end
      Heading "{band.name}"
      list albums as album direction=row
        AlbumCard(album) $play(picked) => @listening(picked)
      end
      when
        @listening => modal
          Player(album=current) $close => @browsing
        end
      end
    end
  end

  component BandResult(band)
    Stack direction=row
      Image src=band.image
      Heading "{band.name}"
      Button "View" $click => $open(band)
    end
  end

  component AlbumCard(album)
    Stack
      Image src=album.cover
      Button "Play" $click => $play(album)
    end
  end

  component Player(album) @paused @playing
    in ~tracks(album=album.id)

    Stack
      Heading "{album.title}"
      Button "Close" $click => $close
      Audio #audio src=album.audio controls
    end

    when
      @paused  => { #audio $play => @playing }
      @playing => { #audio $pause => @paused }
    end
  end
end`;

function errorsOf(src: string): string[] {
	const result = parse(src);
	return result.ok ? [] : result.errors.map((e) => e.message);
}

function expectError(src: string, pattern: RegExp): void {
	const errors = errorsOf(src);
	expect(errors.length).toBeGreaterThan(0);
	expect(errors.some((m) => pattern.test(m))).toBe(true);
}

/** A document with the standard import, an api, and `body`. */
function doc(
	body: string,
	imports = "Stack, Text, Button, Input",
	api = "items, save",
): string {
	return `ui\n  ${STD} ${imports}\n  ${API} ${api}\n${body}\nend`;
}

beforeEach(() => {
	clearUiLibraryAdapters();
});

describe("ui language", () => {
	test("parses screens, components, modes, io, and the entry screen", () => {
		const ast = assertOk<UiAST>(parse(BASIC));
		expect(ast.type).toBe("ui");
		expect(ast.entry).toBe("Search");
		expect(ast.order).toEqual([
			"Search",
			"Band",
			"BandResult",
			"AlbumCard",
			"Player",
		]);
		expect(ast.apis).toEqual([
			{ module: "@test/api", names: ["results", "band", "albums", "tracks"] },
		]);
		const band = ast.components.Band;
		expect(band?.route).toBe("/bands/:id");
		expect(band?.routeParams).toEqual(["id"]);
		expect(band?.modes).toEqual([
			{ name: "browsing" },
			{ name: "listening", param: "current" },
		]);
		expect(band?.io.map((io) => `${io.kind} ~${io.name}`)).toEqual([
			"in ~band",
			"in ~albums",
		]);
		expect(band?.io[0]?.args).toEqual({ id: "id" });
	});

	test("a component's parameters, emits, and scope are computed", () => {
		const ast = assertOk<UiAST>(parse(BASIC));
		expect(ast.components.BandResult?.params).toEqual(["band"]);
		expect(ast.components.BandResult?.emits).toEqual({ open: true });
		expect(ast.components.Player?.emits).toEqual({ close: false });
		expect(ast.components.Band?.scope).toEqual(["id", "band", "albums"]);
		expect(ast.components.Search?.scope).toEqual(["results"]);
	});

	test("tree lines carry content, #id, attributes, flags, and handlers", () => {
		const ast = assertOk<UiAST>(parse(BASIC));
		const search = ast.components.Search?.tree[0];
		const input = search?.children[0];
		expect(input?.name).toBe("Input");
		expect(input?.id).toBe("query");
		expect(input?.attributes).toEqual({ placeholder: "Search bands" });
		const audio = ast.components.Player?.tree[0]?.children[2];
		expect(audio?.flags).toEqual(["controls"]);
		expect(audio?.attributes).toEqual({ src: "album.audio" });
		const view = ast.components.BandResult?.tree[0]?.children[2];
		expect(view?.handlers).toEqual([
			{
				event: "click",
				action: { kind: "emit", event: "open", value: "band" },
			},
		]);
	});

	test("list names its data and item; a handler on the item binds the value", () => {
		const ast = assertOk<UiAST>(parse(BASIC));
		const list = ast.components.Search?.tree[0]?.children[1];
		expect(list?.kind).toBe("list");
		expect(list?.data).toBe("results");
		expect(list?.item).toBe("band");
		const use = list?.children[0];
		expect(use?.args).toEqual({ band: "band" });
		expect(use?.handlers[0]).toEqual({
			event: "open",
			param: "picked",
			action: { kind: "go", screen: "Band", args: { id: "picked.id" } },
		});
		const albums = ast.components.Band?.tree[0]?.children[2];
		expect(albums?.attributes).toEqual({ direction: "row" });
	});

	test("when in the tree yields lines; at component level it yields overrides", () => {
		const ast = assertOk<UiAST>(parse(BASIC));
		const when = ast.components.Band?.tree[0]?.children[0];
		expect(when?.kind).toBe("when");
		expect(when?.cases?.map((c) => c.condition)).toEqual([
			{ kind: "io", name: "band", mode: "loading" },
			{ kind: "io", name: "band", mode: "error" },
		]);
		const modal = ast.components.Band?.tree[0]?.children[3]?.cases?.[0];
		expect(modal?.condition).toEqual({ kind: "mode", mode: "listening" });
		expect(modal?.nodes[0]?.kind).toBe("modal");
		const player = ast.components.Player;
		expect(player?.whens).toHaveLength(1);
		expect(player?.whens[0]?.cases?.[0]?.overrides).toEqual([
			{
				handle: "audio",
				attributes: {},
				flags: [],
				handlers: [
					{ event: "play", action: { kind: "mode", mode: "playing" } },
				],
			},
		]);
	});

	test("document-level in is app data every component can read", () => {
		const ast = assertOk<UiAST>(
			parse(
				doc(
					`  in ~session\n  screen Home route=/\n    Text "{session.user.name}"\n  end`,
					"Text",
					"session",
				),
			),
		);
		expect(ast.io).toEqual([
			{ kind: "in", name: "session", args: {}, outcomes: [] },
		]);
		expect(ast.components.Home?.scope).toEqual(["session"]);
	});

	test("a when with a subject matches values, and a layout argument supplies one", () => {
		const ast = assertOk<UiAST>(
			parse(
				doc(
					`  layout Shell(current)
    Stack
      Nav(current)
      Outlet
    end
  end
  screen Home route=/ layout=Shell(current=Home)
    Text "home"
  end
  component Nav(current)
    Stack direction=row
      Link "Home" #home to=Home
    end
    when current
      Home => { #home selected }
    end
  end`,
					"Stack, Text, Link, Outlet",
				),
			),
		);
		expect(ast.components.Home?.layoutArgs).toEqual({ current: "Home" });
		expect(ast.components.Nav?.whens[0]?.subject).toBe("current");
		expect(ast.components.Nav?.whens[0]?.cases?.[0]?.condition).toEqual({
			kind: "value",
			value: "Home",
		});
	});

	test("when is a block like any other: brace form, end form, and an override block in either", () => {
		const head =
			'ui\n  use "@hello10/diagrams/ui" Stack, Text, Link\n  api "@t/api" x\n';
		const long = `  screen Home route=/ @a @b
    Stack
      Link "A" #la $click => @a
      when
        @a => Text "a"
        else => Text "b"
      end
    end
    when
      @a =>
        #la selected
      end
    end
  end`;
		const short = `  screen Home route=/ @a @b
    Stack { Link "A" #la $click => @a; when { @a => Text "a"; else => Text "b" } }
    when { @a => { #la selected } }
  end`;
		const a = toPlaintext(assertOk<UiAST>(parse(`${head}${long}\nend`)));
		const b = toPlaintext(assertOk<UiAST>(parse(`${head}${short}\nend`)));
		expect(a).toBe(b);
		expect(a).toContain("      @a => { #la selected }");
	});

	test("a case yields one statement; a container's block belongs to the case", () => {
		const ast = assertOk<UiAST>(
			parse(
				doc(
					`  screen Home route=/ @a
    when
      @a => Stack
        Text "x"
        Text "y"
      end
      else => Text "z"
    end
  end`,
				),
			),
		);
		const when = ast.components.Home?.tree[0];
		expect(when?.cases?.[0]?.nodes[0]?.children).toHaveLength(2);
		expect(when?.cases?.[1]?.nodes[0]?.content).toBe("z");
		expectError(
			doc(
				`  screen Home route=/ @a
    when
      @a =>
        Text "x"
        Text "y"
      else => Text "z"
    end
  end`,
			),
			/A case yields one tree line, with its own block when it has one; group several lines in a Stack/,
		);
	});

	test("brace and end forms are the same block", () => {
		const ast = assertOk<UiAST>(
			parse(
				doc(
					`  screen Home route=/\n    out ~save { ready => go Home }\n    Stack { Text "x"; Button "Save" $click => ~save }\n  end`,
				),
			),
		);
		expect(ast.components.Home?.io[0]?.outcomes).toEqual([
			{ mode: "ready", action: { kind: "go", screen: "Home", args: {} } },
		]);
		expect(ast.components.Home?.tree[0]?.children).toHaveLength(2);
	});
});

describe("ui checks", () => {
	test("an unimported standard element names the use line to add", () => {
		expectError(
			`ui\n  screen Home route=/\n    Button "Go"\n  end\nend`,
			/add `use "@hello10\/diagrams\/ui" Button`/,
		);
	});

	test("unresolved names, unknown namespaces, a screen without a route, no screen at /", () => {
		expectError(
			doc(`  screen Home route=/\n    Widget\n  end`),
			/Unresolved "Widget"/,
		);
		expectError(
			doc(`  screen Home route=/\n    App.Nav\n  end`),
			/Unknown namespace "App"/,
		);
		expectError(doc(`  screen Home\n    Text "x"\n  end`), /needs a route/);
		expectError(
			doc(`  screen Home route=/home\n    Text "x"\n  end`),
			/No screen has route=\//,
		);
	});

	test("operations must be declared by an api and by the component that uses them", () => {
		expectError(
			`ui\n  ${STD} Text\n  screen Home route=/\n    in ~items\n    Text "x"\n  end\nend`,
			/~items needs an api declaration/,
		);
		expectError(
			doc(`  screen Home route=/\n    in ~nope\n    Text "x"\n  end`),
			/~nope is not an operation of any declared api/,
		);
		expectError(
			doc(`  screen Home route=/\n    Button "Go" $click => ~save\n  end`),
			/~save is not declared in Home/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    when\n      ~items.error => Text "x"\n    end\n  end`,
			),
			/~items is not declared in Home/,
		);
		// A formal api source accepts any operation.
		expect(
			parse(
				`ui\n  ${STD} Text\n  api "./schema.graphql"\n  screen Home route=/\n    in ~anything\n    Text "x"\n  end\nend`,
			).ok,
		).toBe(true);
	});

	test("io declarations come before the tree, and only outcomes go in an io block", () => {
		expectError(
			doc(`  screen Home route=/\n    Text "x"\n    in ~items\n  end`),
			/in and out declarations go before the tree/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    out ~save\n      loading => { #b busy }\n    end\n    Button "x" #b\n  end`,
			),
			/An outcome is `loading => action`/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    out ~save\n      Text "Saving"\n    end\n    Text "x"\n  end`,
			),
			/An io block holds outcomes only/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    out ~save\n      empty => go Home\n    end\n    Text "x"\n  end`,
			),
			/empty is a mode of an in, not of ~save/,
		);
	});

	test("handlers are checked against what the element or component fires", () => {
		expectError(
			doc(`  screen Home route=/\n    Button "Go" $change => go Home\n  end`),
			/Button does not fire \$change; it fires \$click/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Card $open => go Home\n  end\n  component Card\n    Button "Go" $click => $go\n  end`,
			),
			/Card does not fire \$open; it fires \$go/,
		);
		expectError(
			doc(`  screen Home route=/\n    Button "Go" $click(x) => go Home\n  end`),
			/\$click carries no value; nothing binds to "x"/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Card\n  end\n  component Card\n    Button "Go" $click => $go\n  end`,
			),
			/Card emits \$go and Home never handles it/,
		);
	});

	test("an instance's value is addressed through its handle; a bare name is data", () => {
		expect(
			parse(
				doc(
					`  screen Home route=/\n    in ~items(query=#q.value)\n    Input #q placeholder="Find"\n  end`,
				),
			).ok,
		).toBe(true);
		expectError(
			doc(
				`  screen Home route=/\n    in ~items(query=q.value)\n    Input #q placeholder="Find"\n  end`,
			),
			/"q.value" is a bare name; an instance's value is addressed through its handle: #q.value/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    in ~items(query=#nope.value)\n    Input #q placeholder="Find"\n  end`,
			),
			/#nope is not a handle in Home/,
		);
		expectError(
			doc(`  screen Home route=/\n    Text "{user.name}"\n  end`),
			/"user.name" is not supplied in Home/,
		);
		expectError(
			doc(`  component Card(item)\n    Text "{other}"\n  end`),
			/"other" is not supplied in Card/,
		);
	});

	test("names are local to where they are declared, and declared once", () => {
		expectError(
			doc(
				`  screen Home route=/\n    in ~items\n    Stack\n      list items as item\n        Text "{item.name}"\n      end\n      Text "{item.name}"\n    end\n  end`,
			),
			/"item.name" is not supplied in Home/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    in ~items\n    list items as items\n      Text "x"\n    end\n  end`,
			),
			/"items" is declared twice in Home/,
		);
	});

	test("modes are declared on the header and take a value only when they have a parameter", () => {
		expectError(
			doc(`  screen Home route=/\n    Button "Go" $click => @gone\n  end`),
			/@gone is not a mode of Home; declare it on the header/,
		);
		expectError(
			doc(
				`  screen Home route=/ @a @b(x)\n    Button "Go" $click => @b\n  end`,
			),
			/@b takes a value: @b\(x\)/,
		);
		expectError(
			doc(`  screen Home route=/ @a\n    Button "Go" $click => @a(1)\n  end`),
			/@a takes no value/,
		);
		expectError(
			doc(`  screen Home route=/ @a @a\n    Text "x"\n  end`),
			/Duplicate mode @a/,
		);
		expectError(
			doc(`  screen Home route=/\n    Text "x"\n    @a { }\n  end`),
			/Modes are declared on the header/,
		);
	});

	test("navigation: go names a screen, with its route params", () => {
		expectError(
			doc(
				`  screen Home route=/\n    Button "Go" $click => Detail\n  end\n  screen Detail route=/d\n    Text "x"\n  end`,
			),
			/Navigation is an action with a verb: go Detail/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Button "Go" $click => go Card\n  end\n  component Card\n    Text "x"\n  end`,
			),
			/Card is a component, not a screen/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Button "Go" $click => go Detail\n  end\n  screen Detail route=/d/:id\n    Text "x"\n  end`,
			),
			/Detail needs id/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Button "Go" $click => go Detail(zip=1)\n  end\n  screen Detail route=/d/:id\n    Text "x"\n  end`,
			),
			/Detail has no route param "zip"/,
		);
		expectError(
			doc(`  screen Home route=/\n    Link "Go" to=Nope\n  end`, "Link"),
			/"Nope" is not declared/,
		);
	});

	test("arguments are named and checked against parameters", () => {
		expectError(
			doc(
				`  screen Home route=/\n    Card(title=x)\n  end\n  component Card(item)\n    Text "{item}"\n  end`,
			),
			/Card has no parameter "title"/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Card extra\n  end\n  component Card\n    Text "x"\n  end`,
			),
			/Card is a component; "extra" is not a flag it takes/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Card item=x\n  end\n  component Card(item)\n    Text "{item}"\n  end`,
			),
			/Arguments to Card go in parens: Card\(item=…\)/,
		);
	});

	test("overrides address a handle in a component-level when", () => {
		expectError(
			doc(
				`  screen Home route=/ @a\n    Button "Go" #go\n    when\n      @a => { #nope busy }\n    end\n  end`,
			),
			/#nope is not a handle in Home/,
		);
		expectError(
			doc(`  screen Home route=/\n    Button "Go" #go\n    #go busy\n  end`),
			/An override goes in a component-level when/,
		);
		expectError(
			doc(
				`  screen Home route=/ @a\n    Button "Go" #go\n    when\n      @a => { #go @b }\n    end\n  end`,
			),
			/@b sets a component's mode; #go is not a component instance/,
		);
		expectError(
			doc(
				`  screen Home route=/ @a\n    Card #card\n    when\n      @a => { #card @zzz }\n    end\n  end\n  component Card @x\n    Text "x"\n  end`,
			),
			/Card has no mode @zzz/,
		);
	});

	test("when: else last, values need a subject, a subject takes values", () => {
		expectError(
			doc(
				`  screen Home route=/ @a\n    when\n      else => Text "x"\n      @a => Text "y"\n    end\n  end`,
			),
			/else is the last case/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    when\n      "x" => Text "x"\n    end\n  end`,
			),
			/"x" is a value; matching values needs a subject/,
		);
		expectError(
			doc(
				`  in ~session\n  screen Home route=/\n    when session.role\n      session.admin => Text "x"\n    end\n  end`,
				"Text",
				"session",
			),
			/With a subject, cases are values/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    when\n      @a --> Text "x"\n    end\n  end`,
			),
			/The ui arrow is =>, got -->/,
		);
	});

	test("declaration rules: duplicate ids, unknown flags and attributes, retired words", () => {
		expectError(
			doc(
				`  screen Home route=/\n    Stack\n      Button "A" #b\n      Button "B" #b\n    end\n  end`,
			),
			/Duplicate #b/,
		);
		expectError(
			doc(`  screen Home route=/\n    Text "x" bold\n  end`),
			/Text has no flag "bold"/,
		);
		expectError(
			doc(
				`  screen Home route=/\n    Stack gap=lg\n      Text "x"\n    end\n  end`,
			),
			/Stack has no attribute "gap"/,
		);
		expectError(
			doc(`  screen Home route=/\n    Text "x"\n    state a { }\n  end`),
			/"state" is not a keyword; modes are declared on the header/,
		);
		expectError(
			doc(`  entry Home\n  screen Home route=/\n    Text "x"\n  end`),
			/"entry" is not a keyword/,
		);
		expectError(
			doc(`  screen Home route=/\n    Text data=x\n  end`),
			/data= is gone/,
		);
		expectError(
			doc(`  screen Home route=/\n    Button "Go" id=go\n  end`),
			/Ids are written #name/,
		);
	});
});

describe("ui theme", () => {
	test("a theme directive sets the ink and the accent; defaults fill the rest", () => {
		const themed = assertOk<UiAST>(
			parse(
				`ui\n  %%{theme ink=#002676 accent=#FDB515}%%\n  ${STD} Button\n  screen Home route=/\n    Button "Go" $click => go Home\n  end\nend`,
			),
		);
		expect(themed.theme).toEqual({ ink: "#002676", accent: "#FDB515" });
		const svg = render(themed);
		expect(svg).toContain('fill="#002676"');
		expect(svg).toContain('fill="#FDB515"/><text');
		const text = toPlaintext(themed);
		expect(text).toContain("  %%{theme ink=#002676 accent=#FDB515}%%");
		expect(toPlaintext(assertOk<UiAST>(parse(text)))).toBe(text);
		// Without a directive the defaults apply, and a badge is still
		// distinct from the ink it sits on.
		const plain = render(assertOk<UiAST>(parse(BASIC)));
		expect(plain).toContain('fill="#3299f6"/><text');
		// The numeral contrasts with the accent: white on the dark default,
		// the ink on a light accent.
		expect(plain).toMatch(/fill="#3299f6"\/><text[^>]*fill="#ffffff">1</);
		expect(svg).toMatch(/fill="#FDB515"\/><text[^>]*fill="#002676">1</);
	});

	test("directive errors: unknown directive, unknown setting, bad color", () => {
		expectError(
			doc(`  %%{init: {}}%%\n  screen Home route=/\n    Text "x"\n  end`),
			/Unknown directive "init:"/,
		);
		expectError(
			doc(
				`  %%{theme paper=#fff}%%\n  screen Home route=/\n    Text "x"\n  end`,
			),
			/theme has no setting "paper"/,
		);
		expectError(
			doc(`  %%{theme ink=blue}%%\n  screen Home route=/\n    Text "x"\n  end`),
			/theme ink is a hex color/,
		);
	});
});

describe("ui round-trip", () => {
	test("toPlaintext re-parses to the same AST and is stable", () => {
		const ast1 = assertOk<UiAST>(parse(BASIC));
		const text = toPlaintext(ast1);
		expect(text).toContain('  api "@test/api" results, band, albums, tracks');
		expect(text).toContain("    in ~results(query=#query.value)");
		expect(text).toContain("      list results as band");
		expect(text).toContain(
			"        BandResult(band) $open(picked) => go Band(id=picked.id)",
		);
		expect(text).toContain(
			"  screen Band route=/bands/:id @browsing @listening(current)",
		);
		expect(text).toContain('      Button "View" $click => $open(band)');
		expect(text).toContain("      @paused => { #audio $play => @playing }");
		expect(text).toContain('        ~band.loading => Text "Loading…"');
		const ast2 = assertOk<UiAST>(parse(text));
		expect(toPlaintext(ast2)).toBe(text);
		expect(ast2.components.Band?.io).toEqual(ast1.components.Band?.io);
	});
});

describe("ui rendering", () => {
	test("frames: one per mode, plus one per io condition the tree names", () => {
		const svg = render(assertOk<UiAST>(parse(BASIC)));
		const frames =
			svg.match(/<g data-frame="[^"]+"( data-view="[^"]+")?>/g) ?? [];
		const named = frames.filter((f) => f.includes("data-view"));
		expect(named).toContain('<g data-frame="Band" data-view="@browsing">');
		expect(named).toContain('<g data-frame="Band" data-view="@listening">');
		expect(named).toContain(
			'<g data-frame="Band" data-view="@browsing ~band.loading">',
		);
		expect(named).toContain(
			'<g data-frame="Search" data-view="~results.empty">',
		);
		expect(named).toContain('<g data-frame="Player" data-view="@paused">');
		// A component with neither modes nor io conditions draws one frame.
		expect(svg).toContain('<g data-frame="BandResult">');
		expect(svg).not.toContain('data-frame="BandResult" data-view=');
	});

	test("frames: a loading in hides what it supplies; a modal dims; placeholders are braces", () => {
		const svg = render(assertOk<UiAST>(parse(BASIC)));
		const loading = svg.slice(
			svg.indexOf('data-frame="Band" data-view="@browsing ~band.loading"'),
			svg.indexOf('data-frame="Band" data-view="@browsing ~band.error"'),
		);
		expect(loading).toContain("Loading…");
		expect(loading).not.toContain("band.name");
		const listening = svg.slice(
			svg.indexOf('data-frame="Band" data-view="@listening"'),
			svg.indexOf('data-frame="Band" data-view="@browsing ~band.loading"'),
		);
		expect(listening).toContain("rgba(17, 24, 39, 0.45)");
		expect(listening).toContain("current.title");
		expect(svg).toContain(">{band.name}</text>");
		expect(svg).not.toMatch(/font-style="italic">\{/);
	});

	test("a row that overflows wraps; nothing is squeezed or shortened", () => {
		const svg = render(
			assertOk<UiAST>(
				parse(
					doc(
						`  component Row(ticket)\n    Stack direction=row\n      Text "{ticket.show.venue}"\n      Text "{ticket.show.date}"\n      Text "{ticket.quantity}"\n      Button "Cancel"\n    end\n  end\n  screen Home route=/\n    Text "x"\n  end`,
						"Stack, Text, Button",
					),
				),
			),
		);
		for (const label of [
			"{ticket.show.venue}",
			"{ticket.show.date}",
			"{ticket.quantity}",
			"Cancel",
		]) {
			expect(svg).toContain(`>${label}</text>`);
		}
		expect(svg).not.toContain("…</text>");
		// The row's items land on two lines: the first and last share no y.
		const ys = [
			...svg.matchAll(
				/<text x="[^"]+" y="([^"]+)"[^>]*>\{ticket\.(?:show\.venue|quantity)\}<\/text>/g,
			),
		].map((m) => m[1]);
		expect(new Set(ys).size).toBe(2);
	});

	test("a lone placeholder wider than its frame keeps its tail", () => {
		const svg = render(
			assertOk<UiAST>(
				parse(
					doc(
						`  component Wide(ticket)\n    Text "{ticket.show.venue.address.street.name.and.more.of.it.than.fits.in.one.frame}"\n  end\n  screen Home route=/\n    Text "x"\n  end`,
						"Text",
					),
				),
			),
		);
		expect(svg).toMatch(/>\{…[a-z.]+\}<\/text>/);
		expect(svg).not.toContain(">{ticket…");
	});

	test("callouts: badges on the element a person touches, legends as event → action", () => {
		const svg = render(assertOk<UiAST>(parse(BASIC)));
		const search = svg.slice(
			svg.indexOf('data-frame="Search">'),
			svg.indexOf('data-frame="Search" data-view='),
		);
		// The parent's line as written, badged on the element inside that
		// emits the event.
		expect(search).toContain("open(picked) → go Band(id=picked.id)");
		expect(search).not.toContain("click → go Band");
		expect(search).not.toContain("$open(band)");
		const result = svg.slice(
			svg.indexOf('data-frame="BandResult">'),
			svg.indexOf('data-frame="AlbumCard">'),
		);
		expect(result).toContain("click → $open(band)");
		const band = svg.slice(
			svg.indexOf('data-frame="Band" data-view="@browsing">'),
			svg.indexOf('data-frame="Band" data-view="@listening">'),
		);
		expect(band).toContain("play(picked) → @listening(picked)");
	});

	test("callouts: a handler on a nested instance is badged through the forwarding chain", () => {
		const src = `ui
  use "@hello10/diagrams/ui" Stack, Button, Text
  api "@test/api" featured
  screen Home route=/
    in ~featured
    Stack
      Outer(thing=featured) $open(got) => go Detail(id=got.id)
    end
  end
  screen Detail route=/d/:id
    Text "d"
  end
  component Outer(thing)
    Inner(thing) $pick(v) => $open(v)
  end
  component Inner(thing)
    Button "Go" $click => $pick(thing)
  end
end`;
		const svg = render(assertOk<UiAST>(parse(src)));
		const home = svg.slice(
			svg.indexOf('data-frame="Home">'),
			svg.indexOf('data-frame="Detail">'),
		);
		expect(home).toContain("open(got) → go Detail(id=got.id)");
		// One badge, on the button inside Inner inside Outer.
		expect(
			(home.match(/font-weight="700" fill="#ffffff">1<\/text>/g) ?? []).length,
		).toBe(2);
	});

	test("flow: one node per screen, the entry screen bold, edges for go and to= only", () => {
		const svg = renderUiFlow(assertOk<UiAST>(parse(BASIC)));
		expect((svg.match(/<g data-node="/g) ?? []).length).toBe(2);
		expect(svg).toContain("open BandResult");
		expect(svg).not.toContain("@listening");
		expect(svg).toContain("Search bands");
	});

	test("ascii walks the same expanded tree", () => {
		const text = renderUiAscii(assertOk<UiAST>(parse(BASIC)));
		expect(text).toContain("screen Search\n");
		expect(text).toContain("screen Search ~results.empty\n");
		expect(text).toContain("list x3 column");
		expect(text).toContain("[heading] {band.name}");
		expect(text).toContain("screen Band @listening");
		expect(text).toContain("component BandResult\n");
		expect(text).toContain("  modal\n    Player column");
	});

	test("project adapters map their elements onto render types or custom svg", () => {
		registerUiLibraryAdapter({
			module: "@acme/ui",
			elements: {
				Hero: {
					renderSvg: ({ x, y, width }) =>
						`<rect x="${x}" y="${y}" width="${width}" height="48"/><text>Custom Hero</text>`,
				},
				Cta: { type: "button" },
			},
		});
		const ast = assertOk<UiAST>(
			parse(
				`ui\n  use "@acme/ui" Hero, Cta\n  ${STD} Stack\n  screen Home route=/\n    Stack\n      Hero\n      Cta "Go"\n    end\n  end\nend`,
			),
		);
		const svg = render(ast);
		expect(svg).toContain("Custom Hero");
		expect(svg).toContain(">Go</text>");
	});
});

describe("review fixes", () => {
	test("a quoted argument is literal text: it renders as that text and round-trips with its quotes", () => {
		const src = `ui
  ${STD} Stack, Text
  screen Home route=/
    Stack
      Card(title="Hello there")
      Card(title=greeting)
    end
  end
  component Card(title)
    Text "{title}"
  end
end`;
		const r = parse(src);
		const messages = r.ok ? [] : r.errors.map((e) => e.message);
		// The bare name is the only one that is not supplied.
		expect(messages).toEqual([
			'"greeting" is not supplied in Home: no parameter, route param, in, list item, or handler param provides "greeting"',
		]);
		const ok = assertOk<UiAST>(
			parse(src.replace("      Card(title=greeting)\n", "")),
		);
		expect(ok.components.Home?.tree[0]?.children[0]?.args).toEqual({
			title: '"Hello there"',
		});
		expect(toPlaintext(ok)).toContain('Card(title="Hello there")');
		const svg = render(ok);
		expect(svg).toContain(">Hello there</text>");
		expect(svg).not.toContain('{"Hello there"}');
	});

	test("an override's handler for an event replaces the element's own", () => {
		const src = `ui
  ${STD} Button
  screen Home route=/ @stopped @playing
    Button "Play" #play $click => @playing
    when
      @playing => { #play "Pause" $click => @stopped }
    end
  end
end`;
		const svg = render(assertOk<UiAST>(parse(src)));
		const playing = svg.slice(
			svg.indexOf('data-view="@playing"'),
			svg.indexOf(">Components</text>") === -1
				? undefined
				: svg.indexOf(">Components</text>"),
		);
		expect(playing).toContain("click → @stopped");
		expect(playing).not.toContain("click → @playing");
	});

	test("the gap between tiers is the same with or without a layouts tier", () => {
		const doc = (layout: string, use: string) => `ui
  ${STD} Text, Outlet
  ${layout}
  screen Home route=/${use}
    Text "home"
  end
  screen Other route=/other${use}
    Text "other"
  end
end`;
		const gap = (svg: string) => {
			const flowRule = /<line x1="40" y1="(\d+)"[^>]*stroke-width="1"\/>/.exec(
				svg,
			);
			const screens = /<text x="40" y="(\d+)"[^>]*>Screens<\/text>/.exec(svg);
			const prev = svg.slice(0, screens?.index ?? 0);
			const lastFrame = [
				...prev.matchAll(/<rect x="40" y="(\d+)"[^>]*height="(\d+)"/g),
			].pop();
			return {
				rule: Number(flowRule?.[1]),
				screens: Number(screens?.[1]),
				lastBottom: lastFrame ? Number(lastFrame[1]) + Number(lastFrame[2]) : 0,
			};
		};
		const bare = render(assertOk<UiAST>(parse(doc("", ""))));
		const withLayout = render(
			assertOk<UiAST>(
				parse(doc("layout Shell\n    Outlet\n  end", " layout=Shell")),
			),
		);
		expect(bare).toContain(">Flow</text>");
		expect(withLayout).toContain(">Layouts</text>");
		expect(gap(bare).screens).toBeGreaterThan(0);
		expect(gap(withLayout).screens).toBeGreaterThan(0);
	});
});
