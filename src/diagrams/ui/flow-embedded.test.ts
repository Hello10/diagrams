import { parse, render } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import { renderUiFlow } from "./index.ts";
import type { UiAST } from "./uiTypes.ts";

const WITH_LAYOUT = `ui
  use "@hello10/diagrams/ui" Stack, Text, Button, Outlet
  api "@test/api" signOut
  layout Shell
    Stack
      Nav
      Outlet
    end
  end
  screen Home route=/ layout=Shell
    Text "home"
  end
  screen Settings route=/settings layout=Shell
    Text "settings"
  end
  screen Login route=/login layout=Bare
    Text "login"
  end
  layout Bare
    Outlet
  end
  component Nav
    out ~signOut
      ready => go Login
    end
    Stack direction=row
      Button "Log out" $click => ~signOut
    end
  end
end`;

describe("layouts", () => {
	test("a screen uses the layout it names; with one layout, every screen uses it", () => {
		const ast = assertOk<UiAST>(parse(WITH_LAYOUT));
		expect(ast.components.Login?.usesLayout).toBe("Bare");
		expect(ast.components.Home?.usesLayout).toBe("Shell");
	});

	const oneLayout = () =>
		WITH_LAYOUT.replace("  layout Bare\n    Outlet\n  end\n", "").replace(
			" layout=Bare",
			"",
		);

	test("frames draw the screen inside its layout's Outlet", () => {
		const ast = assertOk<UiAST>(parse(oneLayout()));
		expect(ast.components.Home?.usesLayout).toBe("Shell");
		const svg = render(ast);
		const home = svg.slice(
			svg.indexOf('data-frame="Home"'),
			svg.indexOf('data-frame="Settings"'),
		);
		expect(home).toContain(">Log out</text>");
		expect(home).toContain(">home</text>");
	});

	test("the flow draws the layout as a node and its navigation once, from it", () => {
		const ast = assertOk<UiAST>(parse(oneLayout()));
		const svg = renderUiFlow(ast);
		expect(svg).toContain('data-node="Shell"');
		expect((svg.match(/Nav · ~signOut.ready/g) ?? []).length).toBe(1);
		// Wrapped screens carry no tag; the nav in each thumbnail shows it.
		expect(svg).not.toContain("· layout");
	});

	test("checks: one Outlet per layout, Outlet only in layouts, layout= must name a layout, ambiguity", () => {
		const errors = (src: string) => {
			const r = parse(src);
			return r.ok ? [] : r.errors.map((e) => e.message);
		};
		expect(
			errors(
				`ui\n  use "@hello10/diagrams/ui" Text\n  layout Shell\n    Text "x"\n  end\n  screen Home route=/\n    Text "h"\n  end\nend`,
			),
		).toContainEqual(
			"layout Shell needs exactly one Outlet, where the screen goes; it has 0",
		);
		expect(
			errors(
				`ui\n  use "@hello10/diagrams/ui" Outlet\n  screen Home route=/\n    Outlet\n  end\nend`,
			),
		).toContainEqual("Outlet is only valid inside a layout");
		expect(
			errors(
				`ui\n  use "@hello10/diagrams/ui" Text\n  screen Home route=/ layout=Nope\n    Text "h"\n  end\nend`,
			),
		).toContainEqual("layout=Nope does not name a layout");
		expect(errors(WITH_LAYOUT.replace(/ layout=\w+/g, ""))).toContainEqual(
			"Login must say which layout wraps it (layout=Shell|Bare); the document declares more than one",
		);
	});
});

describe("layout arguments", () => {
	const doc = (screens: string) => `ui
  use "@hello10/diagrams/ui" Stack, Link, Text, Outlet
${screens}
  layout Shell(current)
    Stack
      Nav(current)
      Outlet
    end
  end
  component Nav(current)
    Stack direction=row
      Link "Home" #home to=Home
      Link "About" #about to=About
    end
    when current
      Home  => { #home selected }
      About => { #about selected }
    end
  end
end`;

	test("a screen passes a value to its layout, and a component matches on it", () => {
		const r = parse(
			doc(
				`  screen Home route=/ layout=Shell(current=Home)
    Text "hi"
  end
  screen About route=/about layout=Shell(current=About)
    Text "about"
  end
  screen Other route=/other layout=Shell
    Text "other"
  end`,
			),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const ast = r.ast as UiAST;
		expect(ast.components.About?.layoutArgs).toEqual({ current: "About" });
		expect(ast.components.About?.usesLayout).toBe("Shell");
		const svg = render(ast);
		const between = (from: string, to: string) =>
			svg.slice(svg.indexOf(from), svg.indexOf(to));
		const about = between('data-frame="About">', 'data-frame="Other">');
		const other = between('data-frame="Other">', ">Components</text>");
		const shell = between('data-frame="Shell">', 'data-frame="Home">');
		expect(about).toMatch(/font-weight="700"[^>]*>About<\/text>/);
		expect(about).toMatch(/text-decoration="underline">Home<\/text>/);
		// With no argument nothing matches: no link is selected.
		expect(other).toMatch(/text-decoration="underline">Home<\/text>/);
		expect(other).toMatch(/text-decoration="underline">About<\/text>/);
		// A screen draws its layout dimmed and lists none of its actions;
		// the layout's own section lists them once.
		expect(about).toContain('data-chrome="true"');
		// The slot the screen fills is outlined faintly, with the same dash
		// the layout's empty Outlet has.
		expect(about).toContain('stroke-dasharray="4,3" opacity="0.5"');
		expect(about).not.toContain("click → go");
		expect(shell).toContain("click → go Home");
		expect(shell).toContain("click → go About");
	});

	test("errors: an unknown layout parameter", () => {
		const bad = parse(
			doc(
				`  screen Home route=/ layout=Shell(nowhere=Home)
    Text "hi"
  end
  screen About route=/about layout=Shell(current=About)
    Text "about"
  end`,
			),
		);
		expect(bad.ok).toBe(false);
		if (bad.ok) return;
		const messages = bad.errors.map((e) => e.message).join("\n");
		expect(messages).toContain('Shell has no parameter "nowhere"');
	});
});
