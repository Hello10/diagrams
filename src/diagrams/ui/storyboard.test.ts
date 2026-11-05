import { parse, render } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import type { UiAST } from "./uiTypes.ts";

const SRC = `ui
  use "@hello10/diagrams/ui" Stack, Text, Button, Audio
  api "@test/api" featured, item
  screen Home route=/ @browsing @open
    in ~featured
    Stack
      Card(show=featured)
      Button "Open" $click => @open
      when @
        open { Player $close => @browsing }
      end
    end
  end
  screen Detail route=/d/:id
    in ~item(id)
    Text "detail"
  end
  component Card(show)
    Stack
      Text "{show.title}"
      Button "Go" $click => go Detail(id=show.id)
    end
  end
  component Player @playing @paused
    Stack
      Button "Close" $click => $close
      Audio #audio
    end
    when @
      playing { #audio $pause => @paused }
      paused  { #audio $play => @playing }
    end
  end
end`;

describe("storyboard", () => {
	const svg = render(assertOk<UiAST>(parse(SRC)));

	test("sections: flow overview, a section per screen, a section per component once", () => {
		expect(svg).toContain(">Flow</text>");
		expect(svg).toContain(">Screens</text>");
		expect(svg).toContain(">Components</text>");
		expect(svg).toContain(">Home</text>");
		expect(svg).toContain(">Detail</text>");
		expect(svg).toContain(">Player</text>");
		expect(svg).toContain(">in Home @open</text>");
		// Card has one appearance: it appears inside Home and gets one frame.
		expect(svg).toMatch(/<text[^>]*font-weight="700"[^>]*>Card<\/text>/);
		expect(svg).toContain('data-frame="Card">');
	});

	test("a component with modes gets a mode chart; frames carry callouts", () => {
		for (const mode of ["browsing", "open", "playing", "paused"]) {
			expect(svg).toMatch(new RegExp(`font-weight="600">${mode}</text>`));
		}
		for (const label of [
			"click Open",
			"close Player",
			"pause Audio",
			"play Audio",
		]) {
			expect(svg).toContain(`>${label}</text>`);
		}
		expect(svg).toContain("click → go Detail(id=featured.id)");
		expect(svg).toContain("click → @open");
		expect(svg).toContain("close → @browsing");
		expect(svg).toContain('font-weight="700" fill="#ffffff">1</text>');
	});

	test("arguments substitute into placeholders in the parent; the component's own frame keeps its names", () => {
		expect(svg).toContain(">{featured.title}</text>");
		expect(svg).toContain(">{show.title}</text>");
	});

	test("a frame shows the screen and nothing else: no tags on instances", () => {
		expect(svg).not.toContain("· 2 modes");
		expect(svg).toContain('data-frame="Player"');
	});
});

describe("io views list only what the condition adds", () => {
	const src = `ui
  use "@hello10/diagrams/ui" Stack, Link, Text, Button
  api "@test/api" items
  screen Home route=/ @all @mine
    in ~items
    Stack
      Stack direction=row
        Link "All" #all $click => @all
        Link "Mine" #mine $click => @mine
      end
      when ~items
        error { Button "Retry" $click => ~items }
        empty { Text "Nothing here." }
      end
    end
    when @
      all  { #all selected }
      mine { #mine selected }
    end
  end
end`;

	test("tabs are called out under the mode view once; a variant calls out only its own retry", () => {
		const svg = render(assertOk<UiAST>(parse(src)));
		const legends = (svg.match(/>click → [^<]+<\/text>/g) ?? []).map((s) =>
			s.slice(1, -7),
		);
		expect(legends).toEqual([
			"click → @mine",
			"click → @all",
			"click → ~items",
		]);
	});
});
