/**
 * state/parser.test.ts
 *
 * Unit tests for the StateParser in isolation.
 * Structural assertions on the AST — not rendering or API integration.
 *
 * Compatibility fixtures verify that valid plaintext state diagram syntax
 * parses without hard errors. The bar is structural equivalence, not
 * pixel-identical output.
 */

import { createParseHelper } from "../../testUtils.ts";
import { tokenize } from "../../tokenizer.ts";
import { StateParser } from "./StateParser.ts";
import type { StateDiagramAST } from "./stateTypes.ts";

const parse = createParseHelper<StateDiagramAST, StateParser>(StateParser);

// ─── States ───────────────────────────────────────────────────────────────────

describe("states", () => {
	test("start pseudo-state [*] is registered", () => {
		const ast = parse(`stateDiagram-v2
  [*] --> Offline`);
		const ids = ast.states.map((s) => s.id);
		expect(ids).toContain("[*]");
		expect(ids).toContain("Offline");
	});

	test("bare state identifier is registered", () => {
		const ast = parse(`stateDiagram-v2
  Connecting`);
		expect(ast.states.map((s) => s.id)).toContain("Connecting");
	});

	test("state with human-readable label", () => {
		const ast = parse(`stateDiagram-v2
  state "Waiting for reply" as Pending`);
		const s = ast.states.find((s) => s.id === "Pending");
		expect(s?.label).toBe("Waiting for reply");
	});

	test("transitions from and back to the start pseudo-state", () => {
		const ast = parse(`stateDiagram-v2
  [*] --> Connecting
  Connecting --> [*]`);
		expect(ast.transitions).toHaveLength(2);
		expect(ast.transitions[0]?.from).toBe("[*]");
		expect(ast.transitions[1]?.to).toBe("[*]");
	});

	test("transition labels are captured", () => {
		const ast = parse(`stateDiagram-v2
  Idle --> Connecting : user initiated
  Connecting --> Connected : handshake ok`);
		const labeled = ast.transitions.filter((t) => t.label);
		expect(labeled).toHaveLength(2);
		expect(labeled[0]?.label).toBe("user initiated");
	});

	test("compound state with nested children", () => {
		const ast = parse(`stateDiagram-v2
  state "Authenticated Session" as Session {
    state "Browsing" as Browsing
    state "Checking out" as Checkout
    [*] --> Browsing
    Browsing --> Checkout : add to cart
    Checkout --> Browsing : cancel
  }`);
		const compound = ast.states.find((s) => s.id === "Session");
		expect(compound).toBeDefined();
	});
});

// ─── Notes ───────────────────────────────────────────────────────────────────

describe("notes", () => {
	test("inline note right of a state", () => {
		const ast = parse(`stateDiagram-v2
  Connected
  note right of Connected: max 30s idle timeout`);
		expect(ast.notes).toHaveLength(1);
		expect(ast.notes[0]?.state).toBe("Connected");
		expect(ast.notes[0]?.position).toBe("right of");
		expect(ast.notes[0]?.text).toBe("max 30s idle timeout");
	});

	test("inline note left of a state", () => {
		const ast = parse(`stateDiagram-v2
  Connecting
  note left of Connecting: exponential backoff`);
		expect(ast.notes[0]?.position).toBe("left of");
	});
});

// ─── Metadata ────────────────────────────────────────────────────────────────

describe("metadata", () => {
	test("title is captured", () => {
		const ast = parse(`stateDiagram-v2
  title WebSocket Connection Lifecycle
  [*] --> Disconnected`);
		expect(ast.title).toBe("WebSocket Connection Lifecycle");
	});
});

// ─── Compatibility — parse-without-error fixtures ────────────────────────────
// Exercises the full range of plaintext state diagram syntax.
// The bar: valid input must parse without hard errors (warnings are acceptable).

// Named sources — defined once, referenced in FIXTURES and ROUND_TRIP_CASES.
const src = {
	singleTransitionFromStart: `stateDiagram-v2
  [*] --> Disconnected`,

	fullLifecycleWithReturn: `stateDiagram-v2
  [*] --> Disconnected
  Disconnected --> [*]`,

	fanOutWithLabeledTransitions: `stateDiagram-v2
  [*] --> Idle
  Idle --> Connecting : connect
  Idle --> Maintenance : admin
  Idle --> ShuttingDown : shutdown
  Idle --> [*]`,

	compoundStateWithInternalTransitions: `stateDiagram-v2
  state "Authenticated Session" as Session {
    state "Browsing" as Browsing
    state "Checkout" as Checkout
    [*] --> Browsing
    Browsing --> Checkout : proceed
    Checkout --> Browsing : back
  }`,

	multiLineNoteBlock: `stateDiagram-v2
  Connected
  note right of Connected
  Idle connections are
  closed after 30s
  end note`,

	aliasedStateWithReservedWordInLabel: `stateDiagram-v2
  state "as needed" as OnDemand`,

	legacyKeyword: `stateDiagram
  [*] --> Offline
  Offline --> Online`,

	selfLoop: `stateDiagram-v2
  Polling --> Polling : no new data`,

	linearChainWithStartAndEnd: `stateDiagram-v2
  [*] --> Pending
  Pending --> Processing
  Processing --> [*]`,

	longLinearChain: `stateDiagram-v2
  [*] --> Init
  Init --> Connecting
  Connecting --> Authenticating
  Authenticating --> Ready
  Ready --> [*]`,

	// Round-trip sources
	simpleLifecycle: `stateDiagram-v2
  [*] --> Disconnected
  Disconnected --> Connected
  Connected --> [*]`,

	transitionsWithEventLabels: `stateDiagram-v2
  [*] --> Offline
  Offline --> Online : connect
  Online --> [*] : disconnect`,

	stateWithDisplayLabel: `stateDiagram-v2
  state "Waiting for Input" as Waiting
  [*] --> Waiting`,
};

describe("compatibility — must parse without error", () => {
	const FIXTURES: [string, string][] = [
		["single transition from start", src.singleTransitionFromStart],
		["full lifecycle with return to start", src.fullLifecycleWithReturn],
		[
			"fan-out with multiple labeled transitions",
			src.fanOutWithLabeledTransitions,
		],
		[
			"compound state with labeled internal transitions",
			src.compoundStateWithInternalTransitions,
		],
		["multi-line note block", src.multiLineNoteBlock],
		[
			"aliased state where alias contains reserved word",
			src.aliasedStateWithReservedWordInLabel,
		],
		["legacy stateDiagram keyword", src.legacyKeyword],
		["self-loop transition", src.selfLoop],
		["linear chain with start and end", src.linearChainWithStartAndEnd],
		["long linear chain", src.longLinearChain],
	];

	for (const [description, source] of FIXTURES) {
		test(description, () => {
			const tokens = tokenize(source);
			const parser = new StateParser(tokens);
			parser.setSource(source.split("\n"));
			const result = parser.parse();
			const hardErrors = result.ok
				? []
				: result.errors.filter((e) => e.severity === "error");
			expect(hardErrors).toHaveLength(0);
		});
	}
});
