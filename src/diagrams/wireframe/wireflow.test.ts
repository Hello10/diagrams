import { parse, render, toPlaintext } from "../../api.ts";
import { assertOk } from "../../testUtils.ts";
import type { WireflowAST, WireframeAST } from "./wireframeTypes.ts";

const BASIC_WIREFLOW = `wireflow
  decision paymentOk "Payment accepted?"

  [*] --> Login
  Login -->|call onSignIn| Home
  Login -->|goto signupLink| Signup
  Home -->|state create| Home.paying
  Home.paying -->|call onPay| paymentOk
  paymentOk -->|yes| ShowDetail
  paymentOk -->|no| Home.paying
  Home -->|call onLogout| [*]
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

describe("wireflow language", () => {
	test("parses screens, screen states, decisions, and typed edges", () => {
		const ast = assertOk<WireflowAST>(parse(BASIC_WIREFLOW));
		expect(ast.type).toBe("wireflow");
		expect(ast.order).toEqual([
			"paymentOk",
			"Login",
			"Home",
			"Signup",
			"Home.paying",
			"ShowDetail",
		]);
		expect(ast.nodes["Home.paying"]).toEqual({
			kind: "screen",
			id: "Home.paying",
			ref: { screen: "Home", state: "paying" },
		});
		expect(ast.nodes.paymentOk).toEqual({
			kind: "decision",
			id: "paymentOk",
			question: "Payment accepted?",
		});
		expect(ast.entries).toEqual(["Login"]);
		expect(ast.exits).toEqual(["Home"]);
	});

	test("edges carry interaction kind and trigger, or a branch label", () => {
		const ast = assertOk<WireflowAST>(parse(BASIC_WIREFLOW));
		expect(ast.edges).toContainEqual({
			from: "Login",
			to: "Home",
			interaction: "call",
			trigger: "onSignIn",
		});
		expect(ast.edges).toContainEqual({
			from: "Home",
			to: "Home.paying",
			interaction: "state",
			trigger: "create",
		});
		expect(ast.edges).toContainEqual({
			from: "paymentOk",
			to: "ShowDetail",
			branch: "yes",
		});
		expect(ast.edges).toContainEqual({ from: "[*]", to: "Login" });
		expect(ast.edges).toContainEqual({
			from: "Home",
			to: "[*]",
			interaction: "call",
			trigger: "onLogout",
		});
	});

	test("a trigger is optional; an isolated screen can be declared", () => {
		const ast = assertOk<WireflowAST>(
			parse(`wireflow
  screen Settings
  Home -->|goto| Detail
end`),
		);
		expect(ast.edges).toEqual([
			{ from: "Home", to: "Detail", interaction: "goto" },
		]);
		expect(ast.order).toEqual(["Settings", "Home", "Detail"]);
	});

	test("toPlaintext round-trips and is stable", () => {
		const ast1 = assertOk<WireflowAST>(parse(BASIC_WIREFLOW));
		const text = toPlaintext(ast1);
		expect(text).toContain('decision paymentOk "Payment accepted?"');
		expect(text).toContain("Login -->|call onSignIn| Home");
		expect(text).toContain("paymentOk -->|yes| ShowDetail");
		expect(text).toContain("[*] --> Login");
		const ast2 = assertOk<WireflowAST>(parse(text));
		expect(ast2.edges).toEqual(ast1.edges);
		expect(toPlaintext(ast2)).toBe(text);
	});
});

describe("wireflow validation", () => {
	test("rejects untyped edges between screens", () => {
		expectError(
			`wireflow
  Home --> Detail
end`,
			/need an interaction/,
		);
	});

	test("rejects unknown interaction kinds", () => {
		expectError(
			`wireflow
  Home -->|click save| Detail
end`,
			/start with goto, state, or call/,
		);
	});

	test("rejects decision edges without a branch label", () => {
		expectError(
			`wireflow
  decision ok "Ok?"
  ok --> Home
end`,
			/need a branch label/,
		);
	});

	test("rejects state edges that leave the screen", () => {
		expectError(
			`wireflow
  Home -->|state go| Detail.open
end`,
			/stays within one screen/,
		);
	});

	test("rejects entry edges into decisions and labeled entry edges", () => {
		expectError(
			`wireflow
  decision ok "Ok?"
  [*] --> ok
end`,
			/must lead to a screen/,
		);
		expectError(
			`wireflow
  [*] -->|goto| Home
end`,
			/take no label/,
		);
	});

	test("rejects legacy ref blocks and wireframe keywords", () => {
		expectError(
			`wireflow
  ref Home
    @onSignIn --> Detail
  end
end`,
			/legacy wireflow syntax/,
		);
		expectError(
			`wireflow
  use @acme/ui Button
end`,
			/belongs to wireframe/,
		);
	});
});

describe("wireflow rendering", () => {
	test("renders every node and labeled edge", () => {
		const ast = assertOk<WireflowAST>(parse(BASIC_WIREFLOW));
		const svg = render(ast);
		expect(svg).toContain("<svg");
		for (const label of [
			"Login",
			"Home",
			"Signup",
			"ShowDetail",
			"Payment accepted?",
		]) {
			expect(svg).toContain(label);
		}
		for (const label of [
			"call onSignIn",
			"goto signupLink",
			"state create",
			"yes",
			"no",
		]) {
			expect(svg).toContain(label);
		}
	});

	test("draws thumbnails from attached wireframes", () => {
		const wireframe = assertOk<WireframeAST>(
			parse(`wireframe
  use @hello10/diagrams/ui Text, Button
  screen Home
    Text "Shows" size=lg weight=bold
    Button "Create" id=create -->|state| paying
    state paying
      Text "Paying now"
    end
  end
end`),
		);
		const ast = assertOk<WireflowAST>(
			parse(`wireflow
  [*] --> Home
  Home -->|state create| Home.paying
end`),
		);
		ast.wireframes = { Home: wireframe };
		const svg = render(ast);
		expect(svg).toContain("Shows");
		expect(svg).toContain("Paying now");
	});
});
