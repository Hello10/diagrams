import { parse, toPlaintext } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import type { WireflowAST } from "./wireframeTypes.ts";

const BASIC_WIREFLOW = `wireflow
  ref LoginScreen
    @onSignIn --> HomeScreen
  end

  screen HomeScreen
    Text "Home"
  end
end`;

describe("wireflow", () => {
	test("parses basic wireflow successfully", () => {
		const ast = assertOk<WireflowAST>(parse(BASIC_WIREFLOW));
		expect(ast.type).toBe("wireflow");
		expect(ast.screens).toBeDefined();
		expect(ast.order.length).toBe(2);
	});

	test("toPlaintext round-trips wireflow", () => {
		const ast1 = assertOk<WireflowAST>(parse(BASIC_WIREFLOW));
		const Text = toPlaintext(ast1);
		const ast2 = assertOk<WireflowAST>(parse(Text));
		expect(ast2.order.length).toBe(ast1.order.length);
	});
});
