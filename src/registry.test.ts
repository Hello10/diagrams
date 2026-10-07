import { Diagram } from "./Diagram.ts";
import {
	clearRegistry,
	detectDiagram,
	getDiagram,
	getRegisteredDiagrams,
	registerDiagram,
} from "./registry.ts";
import type { DiagramAST, ParseResult, Token } from "./types.ts";

class MockDiagram extends Diagram {
	readonly type: string;
	readonly name: string;

	constructor(type = "mock", name = "Mock Diagram") {
		super();
		this.type = type;
		this.name = name;
	}

	detect(line: string): boolean {
		return line === this.type;
	}
	parse(_tokens: Token[]): ParseResult<DiagramAST> {
		return { ok: true, ast: { type: this.type } };
	}
	render(): string {
		return "<svg/>";
	}
	toPlaintext(): string {
		return this.type;
	}
}

describe("registry", () => {
	beforeEach(() => {
		clearRegistry();
	});

	test("registerDiagram adds a diagram to the registry", () => {
		const mock = new MockDiagram();
		registerDiagram(mock);
		expect(getDiagram("mock")).toBe(mock);
	});

	test("registerDiagram overwrites existing registration for the same type", () => {
		registerDiagram(new MockDiagram());
		registerDiagram(new MockDiagram("mock", "Updated Mock"));
		expect(getDiagram("mock")?.name).toBe("Updated Mock");
	});

	test("getDiagram returns undefined for unknown type", () => {
		expect(getDiagram("unknown")).toBeUndefined();
	});

	test("detectDiagram finds a diagram whose detect() returns true", () => {
		const mock = new MockDiagram();
		registerDiagram(mock);
		const found = detectDiagram("mock");
		expect(found).toBe(mock);
	});

	test("detectDiagram returns undefined when no type matches", () => {
		registerDiagram(new MockDiagram());
		expect(detectDiagram("sequenceDiagram")).toBeUndefined();
	});

	test("getRegisteredDiagrams returns all registered diagrams", () => {
		registerDiagram(new MockDiagram());
		registerDiagram(new MockDiagram("second", "Second"));
		const all = getRegisteredDiagrams();
		expect(all).toHaveLength(2);
		expect(all.map((d) => d.type)).toContain("mock");
		expect(all.map((d) => d.type)).toContain("second");
	});

	test("clearRegistry removes all registrations", () => {
		registerDiagram(new MockDiagram());
		clearRegistry();
		expect(getDiagram("mock")).toBeUndefined();
		expect(getRegisteredDiagrams()).toHaveLength(0);
	});
});
