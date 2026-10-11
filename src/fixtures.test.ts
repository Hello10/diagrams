import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, render, toPlaintext } from "./api.ts";
import type { FlowchartAST } from "./diagrams/flowchart/flowchartTypes.ts";
import type { SequenceDiagramAST } from "./diagrams/sequence/sequenceTypes.ts";
import type { StateDiagramAST } from "./diagrams/state/stateTypes.ts";
import type {
	WireflowAST,
	WireframeAST,
} from "./diagrams/wireframe/wireframeTypes.ts";
import { assertOk } from "./testUtils.ts";

const fixturesDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../examples/diagrams",
);

function readFixture(name: string): string {
	return readFileSync(resolve(fixturesDir, `${name}.txt`), "utf8");
}

/** Return any attribute occurrences in the SVG whose values aren't quoted with
 * `"` or `'`. An empty list means every attribute is properly quoted. */
function findUnquotedAttributes(svg: string): string[] {
	// Match `name=value` where value doesn't start with a quote. Excludes
	// attribute name characters that are clearly inside template literals or
	// CSS rules (e.g. the `<style>` body uses `:`, not `=`).
	const hits: string[] = [];
	const re = /(\s)([a-zA-Z][\w-]*)=([^"'\s>][^\s>]*)/g;
	let m: RegExpExecArray | null = re.exec(svg);
	while (m !== null) {
		hits.push(`${m[2]}=${m[3]}`);
		m = re.exec(svg);
	}
	return hits;
}

/** Walk the SVG counting open and close tags. Returns a list of imbalance
 * descriptions (e.g. unmatched closes, unclosed opens). Empty list = balanced.
 * Self-closing tags (ending with `/>`) and void elements are accounted for. */
function tagImbalance(svg: string): string[] {
	const stack: string[] = [];
	const issues: string[] = [];
	const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
	let m: RegExpExecArray | null = tagRe.exec(svg);
	while (m !== null) {
		const isClose = m[1] === "/";
		const name = m[2] ?? "";
		const selfClose = m[4] === "/";
		if (isClose) {
			const top = stack.pop();
			if (top !== name) {
				issues.push(`Mismatched close: </${name}> (expected </${top ?? "?"}>)`);
			}
		} else if (!selfClose) {
			stack.push(name);
		}
		m = tagRe.exec(svg);
	}
	for (const unclosed of stack) {
		issues.push(`Unclosed: <${unclosed}>`);
	}
	return issues;
}

describe("canonical example fixtures", () => {
	const cases: ReadonlyArray<readonly [string, string]> = [
		["wireframe", "wireframe"],
		["wireflow", "wireflow"],
		["flowchart", "flowchart"],
		["sequence", "sequenceDiagram"],
		["state", "stateDiagram"],
		["class", "classDiagram"],
	];

	for (const [fixtureName, expectedType] of cases) {
		describe(`${fixtureName}.txt`, () => {
			const src = readFixture(fixtureName);

			test("parses without errors", () => {
				const result = parse(src);
				if (!result.ok) {
					throw new Error(
						`parse failed:\n${result.errors
							.map((e) => `  L${e.line}:${e.col} ${e.message}`)
							.join("\n")}`,
					);
				}
				expect(result.ast.type).toBe(expectedType);
			});

			test("renders to SVG", () => {
				const ast = assertOk(parse(src));
				const svg = render(ast);
				expect(svg).toMatch(/^<svg/);
				expect(svg).toContain("</svg>");
			});

			test("renders SVG with all attribute values quoted", () => {
				const ast = assertOk(parse(src));
				const svg = render(ast);
				const unquoted = findUnquotedAttributes(svg);
				if (unquoted.length > 0) {
					throw new Error(
						`SVG output has ${unquoted.length} unquoted attribute(s):\n` +
							unquoted.slice(0, 5).join("\n"),
					);
				}
			});

			test("rendered SVG has balanced open/close tags", () => {
				const ast = assertOk(parse(src));
				const svg = render(ast);
				const imbalance = tagImbalance(svg);
				if (imbalance.length > 0) {
					throw new Error(
						`SVG tag imbalance:\n${imbalance.join("\n")}\n\nOutput head:\n${svg.slice(0, 600)}`,
					);
				}
			});

			test("round-trips through toPlaintext", () => {
				const ast1 = assertOk(parse(src));
				const text = toPlaintext(ast1);
				const result = parse(text);
				if (!result.ok) {
					throw new Error(
						`re-parse of toPlaintext output failed:\n${result.errors
							.map((e) => `  L${e.line}:${e.col} ${e.message}`)
							.join("\n")}\n\nToPlaintext output was:\n${text}`,
					);
				}
				expect(result.ast.type).toBe(expectedType);
			});
		});
	}
});

describe("state.txt structural assertions", () => {
	const ast = assertOk<StateDiagramAST>(parse(readFixture("state")));

	test("captures accTitle", () => {
		expect(ast.accTitle).toBe("Order processing lifecycle");
	});

	test("captures all top-level transitions", () => {
		// [*] -> Pending, Pending -> Active, Pending -> Cancelled,
		// Active -> Done, Done -> [*], Cancelled -> [*]
		const labels = ast.transitions.map(
			(t) => `${t.from} -> ${t.to}${t.label ? `: ${t.label}` : ""}`,
		);
		expect(labels).toEqual(
			expect.arrayContaining([
				"[*] -> Pending",
				"Pending -> Active: payment received",
				"Pending -> Cancelled: cancelled by user",
				"Active -> Done",
				"Done -> [*]",
				"Cancelled -> [*]",
			]),
		);
	});

	test('captures Pending display label via state "Awaiting Approval" as Pending', () => {
		const pending = ast.states.find((s) => s.id === "Pending");
		expect(pending?.label).toBe("Awaiting Approval");
	});

	test("Active is a compound state with internal transitions", () => {
		const active = ast.states.find((s) => s.id === "Active");
		expect(active?.children).toBeDefined();
		expect(active?.children?.length ?? 0).toBeGreaterThanOrEqual(2);
	});

	test("captures both notes with correct positions and text", () => {
		expect(ast.notes).toHaveLength(2);
		const right = ast.notes.find((n) => n.position === "right of");
		expect(right?.state).toBe("Pending");
		expect(right?.text).toBe("Initial state for all orders");
		const left = ast.notes.find((n) => n.position === "left of");
		expect(left?.state).toBe("Done");
		expect(left?.text).toContain("Final state");
	});
});

describe("sequence.txt structural assertions", () => {
	const ast = assertOk<SequenceDiagramAST>(parse(readFixture("sequence")));

	test("captures title", () => {
		expect(ast.title).toBe("User sign-in flow");
	});

	test("captures all four participants with aliases", () => {
		expect(ast.participants).toEqual([
			{ actor: "U", alias: "User", kind: "participant" },
			{ actor: "B", alias: "Browser", kind: "actor" },
			{ actor: "A", alias: "Auth Service", kind: "participant" },
			{ actor: "DB", alias: "Database", kind: "participant" },
		]);
	});

	test("includes an autonumber statement", () => {
		const autonumber = ast.statements.find((s) => s.kind === "autonumber");
		expect(autonumber).toBeDefined();
	});

	test("captures alt with both branches and their conditions", () => {
		const alt = ast.statements.find((s) => s.kind === "alt");
		expect(alt?.branches).toHaveLength(2);
		expect(alt?.branches[0]?.condition).toBe("Credentials valid");
		expect(alt?.branches[1]?.condition).toBe("Credentials invalid");
	});

	test("captures loop, par, rect, and break groups", () => {
		const kinds = ast.statements.map((s) => s.kind);
		expect(kinds).toEqual(
			expect.arrayContaining(["loop", "par", "rect", "break"]),
		);
	});

	test("note over A, DB captures both actors", () => {
		const noteOverPair = ast.statements.find(
			(s) =>
				s.kind === "note" && s.position === "over" && s.actors.length === 2,
		);
		expect(noteOverPair).toBeDefined();
		if (noteOverPair?.kind === "note") {
			expect(noteOverPair.actors).toEqual(["A", "DB"]);
			expect(noteOverPair.text).toBe("Audit trail written");
		}
	});

	test("note left of U and note right of DB are captured", () => {
		const leftOfU = ast.statements.find(
			(s) =>
				s.kind === "note" && s.position === "left of" && s.actors[0] === "U",
		);
		expect(leftOfU).toBeDefined();
		const rightOfDB = ast.statements.find(
			(s) =>
				s.kind === "note" && s.position === "right of" && s.actors[0] === "DB",
		);
		expect(rightOfDB).toBeDefined();
	});
});

describe("rendered SVG content sanity (catches half-empty regressions)", () => {
	test("state.txt SVG contains every top-level state label", () => {
		const svg = render(assertOk(parse(readFixture("state"))));
		for (const label of ["Active", "Done", "Cancelled", "Awaiting Approval"]) {
			expect(svg).toContain(label);
		}
		// Nested labels from inside `Active` and `Working` compound states.
		for (const label of [
			"Idle",
			"Working",
			"Loading",
			"Processing",
			"Saving",
		]) {
			expect(svg).toContain(label);
		}
		// Notes that sit beside specific states.
		expect(svg).toContain("Initial state for all orders");
	});

	test("sequence.txt SVG contains every participant + every message label", () => {
		const svg = render(assertOk(parse(readFixture("sequence"))));
		for (const alias of ["User", "Browser", "Auth Service", "Database"]) {
			expect(svg).toContain(alias);
		}
		for (const label of [
			// Quote characters get escaped to &quot; in the SVG output, so we
			// match the surrounding text instead of the literal quoted form.
			"Click &quot;Sign in&quot;",
			"POST /auth/login",
			"lookup user",
			"user record",
			"200 OK + token",
			"401 Unauthorized",
			"refresh token",
			"log sign-in event",
			"cache invalidate",
		]) {
			expect(svg).toContain(label);
		}
	});

	test("flowchart.txt SVG contains every node label", () => {
		const svg = render(assertOk(parse(readFixture("flowchart"))));
		for (const label of [
			"Incoming request",
			"Has auth header?",
			"Return 401 Unauthorized",
			"Parse JSON body",
			"Schema valid?",
			"Cache lookup",
			"Query database",
			"Process result",
			"Write cache",
			"Return response",
		]) {
			expect(svg).toContain(label);
		}
	});
});

describe("wireframe.txt structural assertions", () => {
	const ast = assertOk<WireframeAST>(parse(readFixture("wireframe")));
	const root = ast.elements[ast.root];
	const home = ast.elements[root?.children?.[0] ?? ""];
	const byId = (id: string) =>
		Object.values(ast.elements).find((n) => n.declaredId === id);

	test("declares two viewports, two imports, and two defines", () => {
		expect(ast.viewports.map((v) => v.name)).toEqual(["mobile", "desktop"]);
		expect(ast.uses).toHaveLength(2);
		expect(Object.keys(ast.defines)).toEqual(["ShowCard", "PaymentDialog"]);
	});

	test("Home has one state and one viewport block", () => {
		expect(home?.screenName).toBe("Home");
		expect(home?.states?.map((s) => s.name)).toEqual(["paying"]);
		expect(home?.viewportOverrides?.map((v) => v.viewport)).toEqual([
			"desktop",
		]);
	});

	test("every construct appears: Stack, repeat, modal, data, overrides, interactions", () => {
		expect(byId("layout")?.component).toEqual({
			kind: "named-import",
			module: "@hello10/diagrams/ui",
			name: "Stack",
		});
		expect(byId("shows")?.nodeKind).toBe("repeat");
		expect(byId("shows")?.data).toBe("Show");
		expect(byId("payment")?.nodeKind).toBe("modal");
		expect(byId("create")?.targetKind).toBe("state");
		expect(byId("create")?.target).toBe("paying");
		expect(home?.states?.[0]?.overrides.map((o) => o.id)).toEqual(["create"]);
		expect(home?.viewportOverrides?.[0]?.overrides.map((o) => o.id)).toEqual([
			"layout",
			"nav",
			"shows",
		]);
		expect(home?.hooks).toEqual(
			expect.arrayContaining(["onOpenShow", "onOpen", "onPay"]),
		);
	});

	test("SVG contains a frame per state per viewport and every label", () => {
		const svg = render(ast);
		expect((svg.match(/data-screen="Home"/g) ?? []).length).toBe(4);
		for (const label of [
			"Shows",
			"Create",
			"Search shows",
			"Confirm purchase",
			"Email me the receipt",
			"Pay $84",
		]) {
			expect(svg).toContain(label);
		}
	});
});

describe("wireflow.txt structural assertions", () => {
	const ast = assertOk<WireflowAST>(parse(readFixture("wireflow")));

	test("captures title, entry, exit, and the decision", () => {
		expect(ast.title).toBe("Ticketing flow");
		expect(ast.entries).toEqual(["Login"]);
		expect(ast.exits).toEqual(["Home"]);
		expect(ast.nodes.paymentOk).toEqual({
			kind: "decision",
			id: "paymentOk",
			question: "Payment accepted?",
		});
	});

	test("addresses a screen state as a node", () => {
		expect(ast.nodes["Home.paying"]).toEqual({
			kind: "screen",
			id: "Home.paying",
			ref: { screen: "Home", state: "paying" },
		});
	});

	test("edges use all three interaction kinds plus decision branches", () => {
		const kinds = new Set(ast.edges.map((e) => e.interaction).filter(Boolean));
		expect([...kinds].sort()).toEqual(["call", "goto", "state"]);
		const branches = ast.edges
			.filter((e) => e.from === "paymentOk")
			.map((e) => e.branch);
		expect(branches).toEqual(["yes", "no"]);
	});

	test("SVG contains every node and every edge label", () => {
		const svg = render(ast);
		for (const label of [
			"Login",
			"Signup",
			"ShowDetail",
			"Payment accepted?",
			"call onSignIn",
			"goto signupLink",
			"state create",
			"state cancel",
			"call onLogout",
		]) {
			expect(svg).toContain(label);
		}
	});
});

describe("flowchart.txt structural assertions", () => {
	const ast = assertOk<FlowchartAST>(parse(readFixture("flowchart")));

	test("direction is TB (TD alias)", () => {
		expect(ast.direction).toBe("TB");
	});

	test("declares the Validate subgraph with its members", () => {
		const sg = ast.subgraphs.find((s) => s.id === "Validate");
		expect(sg).toBeDefined();
		expect(sg?.label).toBe("Validation");
		expect(sg?.children).toEqual(
			expect.arrayContaining(["V1", "V2", "V3", "ValidErr"]),
		);
	});

	test("Validate subgraph id does not also appear as a flow node", () => {
		expect(ast.nodes.find((n) => n.id === "Validate")).toBeUndefined();
	});

	test("captures the auth decision diamond with its label", () => {
		const auth = ast.nodes.find((n) => n.id === "Auth");
		expect(auth?.shape).toBe("diamond");
		expect(auth?.label).toBe("Has auth header?");
	});

	test("captures labeled branches off the Auth diamond", () => {
		const fromAuth = ast.edges.filter((e) => e.from === "Auth");
		const labels = fromAuth.map((e) => e.label);
		expect(labels).toEqual(expect.arrayContaining(["no", "yes"]));
	});

	test("captures all four converging edges to Done", () => {
		const toDone = ast.edges.filter((e) => e.to === "Done");
		const sources = toDone.map((e) => e.from);
		expect(sources).toEqual(
			expect.arrayContaining(["Reject", "ValidErr", "Cached", "Respond"]),
		);
	});

	test("captures the database cylinder shapes", () => {
		const cylinders = ast.nodes.filter((n) => n.shape === "cylinder");
		const cylinderIds = cylinders.map((n) => n.id);
		expect(cylinderIds).toEqual(
			expect.arrayContaining(["Cache", "DB", "Store"]),
		);
	});
});
