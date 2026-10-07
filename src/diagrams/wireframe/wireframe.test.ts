import { parse, render, toPlaintext } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import {
	clearWireframeLibraryAdapters,
	registerWireframeLibraryAdapter,
	WireframeRenderer,
} from "./index.ts";
import type { WireframeAST } from "./wireframeTypes.ts";

function renderWireframeAscii(ast: WireframeAST): string {
	return new WireframeRenderer(ast).renderAscii();
}

const BASIC_WIREFRAME = `wireframe
  use @jump/ui as UI
  use @jump/ui Button, Table
  use @app/components as App

  define ShowCard
    UI.Card
      UI.Image
      Button "Open" -->|call| onOpen
    end
  end

  define PaymentDialog
    UI.Dialog
      UI.Text "Confirm purchase"
      Button "Pay" -->|call| onPay
    end
  end

  screen HomeScreen mobile
    App.Chrome id
      App.Nav id
        Button "Create" id=createButton -->|state| paymentDialogOpen
      end

      App.ShowFeed id=showFeed -->|call| onShowFeedVisible
        repeat ShowCard id=shows -->|call| onOpenShow
      end

      Table id=showsTable
    end
  end

  screen HomeScreen mobile [paymentDialogOpen]
    App.Chrome id
      App.Nav id
        Button "Create" id=createButton -->|state| paymentDialogOpen
      end

      App.ShowFeed id=showFeed -->|call| onShowFeedVisible
        repeat ShowCard id=shows -->|call| onOpenShow
      end

      Table id=showsTable
    end

    modal PaymentDialog id=paymentDialog
  end
end`;

beforeEach(() => {
	clearWireframeLibraryAdapters();
});

describe("wireframe", () => {
	test("parses use declarations, defines, repeat, and modal successfully", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		expect(ast.type).toBe("wireframe");
		expect(ast.uses).toHaveLength(3);
		expect(Object.keys(ast.defines)).toEqual(
			expect.arrayContaining(["ShowCard", "PaymentDialog"]),
		);

		const rootChildren = ast.elements[ast.root]?.children || [];
		expect(rootChildren).toHaveLength(2);

		const [firstScreenId, modalScreenId] = rootChildren;
		const screen = firstScreenId ? ast.elements[firstScreenId] : undefined;
		expect(screen?.nodeKind).toBe("screen");
		expect(screen?.hooks).toEqual(
			expect.arrayContaining(["onShowFeedVisible", "onOpenShow", "onOpen"]),
		);

		const modalScreen = modalScreenId ? ast.elements[modalScreenId] : undefined;
		expect(modalScreen?.hooks).toEqual(
			expect.arrayContaining([
				"onShowFeedVisible",
				"onOpenShow",
				"onPay",
				"onOpen",
			]),
		);

		const repeatNode = Object.values(ast.elements).find(
			(node) => node.nodeKind === "repeat",
		);
		const modalNode = Object.values(ast.elements).find(
			(node) => node.nodeKind === "modal",
		);
		expect(repeatNode?.component?.kind).toBe("local");
		expect(modalNode?.component?.kind).toBe("local");
	});

	test("renders valid SVG using canonical adapter mappings", () => {
		const ast = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const svg = render(ast);
		expect(svg).toContain("<svg");
		expect(svg).toContain("HomeScreen");
		expect(svg).toContain("Confirm purchase");
		expect(svg).toContain("repeat ShowCard");
		expect(svg).toContain("modal PaymentDialog");
	});

	test("toPlaintext round-trips wireframe and canonicalizes declared ids", () => {
		const ast1 = assertOk<WireframeAST>(parse(BASIC_WIREFRAME));
		const text = toPlaintext(ast1);
		expect(text).toContain("use @jump/ui as UI");
		expect(text).toContain("repeat ShowCard id=shows -->|call| onOpenShow");
		expect(text).toContain("modal PaymentDialog id=paymentDialog");
		expect(text).toContain("screen HomeScreen mobile [paymentDialogOpen]");
		expect(text).toContain(
			'Button "Create" id=createButton -->|state| paymentDialogOpen',
		);
		expect(text).toContain("App.Chrome id=chrome");

		const ast2 = assertOk<WireframeAST>(parse(text));
		expect(ast2.uses).toHaveLength(ast1.uses.length);
		expect(Object.keys(ast2.defines)).toEqual(Object.keys(ast1.defines));
	});

	test("parses typed goto targets in wireframe interactions", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @jump/ui Button

  screen HomeScreen mobile
    Button "Open" -->|goto| ShowDetailScreen
  end
end`),
		);

		const screenId = ast.elements[ast.root]?.children?.[0];
		const screen = screenId ? ast.elements[screenId] : undefined;
		const buttonId = screen?.children?.[0];
		const button = buttonId ? ast.elements[buttonId] : undefined;

		expect(button?.nodeKind).toBe("component");
		expect(button?.targetKind).toBe("goto");
		expect(button?.target).toBe("ShowDetailScreen");
	});

	test("rejects legacy list/grid/table wireframe grammar", () => {
		const result = parse(`wireframe
  screen Legacy mobile
    list ShowCard
  end
end`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((error) =>
					/legacy wireframe syntax/i.test(error.message),
				),
			).toBe(true);
		}
	});

	test("rejects wireflow-only keywords in wireframe mode", () => {
		const result = parse(`wireframe
  ref HomeScreen
end`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((error) =>
					/belongs to wireflow/i.test(error.message),
				),
			).toBe(true);
		}
	});

	test("rejects plain --> wireframe interactions without a typed-target label", () => {
		const result = parse(`wireframe
  use @jump/ui Button

  screen HomeScreen mobile
    Button "Open" --> ShowDetailScreen
  end
end`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((error) =>
					/typed-target label/i.test(error.message),
				),
			).toBe(true);
		}
	});

	test("rejects anonymous repeat and modal references", () => {
		const repeatResult = parse(`wireframe
  screen HomeScreen mobile
    repeat
  end
end`);
		expect(repeatResult.ok).toBe(false);

		const modalResult = parse(`wireframe
  screen HomeScreen mobile
    modal
  end
end`);
		expect(modalResult.ok).toBe(false);
	});

	test("fails when derived ids collide within a screen", () => {
		const result = parse(`wireframe
  use @app/components as App

  screen HomeScreen mobile
    App.Chrome id
    App.Chrome id
  end
end`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((error) =>
					/duplicate id "chrome"/i.test(error.message),
				),
			).toBe(true);
		}
	});

	test("supports adapter-based custom SVG and ASCII rendering", () => {
		registerWireframeLibraryAdapter({
			module: "@app/components",
			components: {
				HeroMedia: {
					renderSvg: ({ x, y, width }) =>
						`<rect x="${x}" y="${y}" width="${width}" height="48" fill="white" stroke="#333" /><text x="${x + 8}" y="${y + 28}">Custom Hero</text>`,
					renderAscii: () => "custom hero renderer",
				},
			},
		});

		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @app/components as App

  screen HomeScreen mobile
    App.HeroMedia
  end
end`),
		);

		expect(render(ast)).toContain("Custom Hero");
		expect(renderWireframeAscii(ast)).toContain("custom hero renderer");
	});

	test("falls back to generic rendering for unresolved adapter mappings with valid imports", () => {
		const ast = assertOk<WireframeAST>(
			parse(`wireframe
  use @app/components as App

  screen HomeScreen mobile
    App.Chrome
  end
end`),
		);

		expect(render(ast)).toContain("App.Chrome");
		expect(renderWireframeAscii(ast)).toContain("App.Chrome");
	});
});
