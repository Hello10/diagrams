/**
 * sequence/parser.test.ts
 *
 * Unit tests for the SequenceParser in isolation.
 * Structural assertions on the AST — not rendering or API integration.
 *
 * Compatibility fixtures verify that valid plaintext sequence diagram syntax
 * parses without hard errors. The bar is structural equivalence, not
 * pixel-identical output.
 */

import { createParseHelper } from "../../testUtils.ts";
import { tokenize } from "../../tokenizer.ts";
import { SequenceParser } from "./SequenceParser.ts";
import { SequenceRenderer } from "./SequenceRenderer.ts";
import type { MessageStatement, SequenceDiagramAST } from "./sequenceTypes.ts";

const parse = createParseHelper<SequenceDiagramAST, SequenceParser>(
	SequenceParser,
);

function messages(ast: SequenceDiagramAST): MessageStatement[] {
	return ast.statements.filter(
		(s): s is MessageStatement => s.kind === "message",
	);
}

// ─── Participants ─────────────────────────────────────────────────────────────

describe("participants", () => {
	test("explicit participant declaration", () => {
		const ast = parse(`sequenceDiagram
  participant Client
  participant Server`);
		expect(ast.participants.map((p) => p.actor)).toEqual(["Client", "Server"]);
	});

	test("participant with alias", () => {
		const ast = parse(`sequenceDiagram
  participant C as Client`);
		expect(ast.participants[0]?.alias).toBe("Client");
		expect(ast.participants[0]?.actor).toBe("C");
	});

	test("actor keyword (distinct from participant)", () => {
		const ast = parse(`sequenceDiagram
  actor User`);
		expect(ast.participants[0]?.kind).toBe("actor");
	});

	test("implicit participants registered from messages", () => {
		const ast = parse(`sequenceDiagram
  Client->>Auth: Authenticate
  Auth-->>Client: Token issued`);
		const actors = ast.participants.map((p) => p.actor);
		expect(actors).toContain("Client");
		expect(actors).toContain("Auth");
	});

	test("implicit participants are not duplicated when also explicitly declared", () => {
		const ast = parse(`sequenceDiagram
  participant Client
  Client ->> Server: Request`);
		const clientCount = ast.participants.filter(
			(p) => p.actor === "Client",
		).length;
		expect(clientCount).toBe(1);
	});
});

// ─── Messages — all arrow types ───────────────────────────────────────────────

describe("messages", () => {
	const ARROW_CASES: [string, string][] = [
		["Client->Server: solid open", "->"],
		["Client->>Server: solid filled", "->>"],
		["Client-->Server: dashed open", "-->"],
		["Client-->>Server: dashed filled", "-->>"],
		["Client-xServer: solid cross", "-x"],
		["Client--xServer: dashed cross", "--x"],
		["Client-)Server: solid async", "-)"],
		["Client--)Server: dashed async", "--)"],
	];

	for (const [stmt, expectedArrow] of ARROW_CASES) {
		test(`arrow type: ${expectedArrow}`, () => {
			const ast = parse(`sequenceDiagram\n  ${stmt}`);
			const msg = messages(ast)[0];
			expect(msg?.arrow).toBe(expectedArrow);
		});
	}

	test("message label is captured including punctuation", () => {
		const ast = parse(`sequenceDiagram
  Client ->> Auth: POST /login, credentials attached`);
		expect(messages(ast)[0]?.label).toBe("POST /login, credentials attached");
	});

	test("message with empty label", () => {
		const ast = parse(`sequenceDiagram
  Client ->> Server:`);
		expect(messages(ast)[0]?.label).toBe("");
	});

	test("self-message (same actor both ends)", () => {
		const ast = parse(`sequenceDiagram
  Worker ->> Worker: process queue`);
		const msg = messages(ast)[0];
		expect(msg?.from).toBe("Worker");
		expect(msg?.to).toBe("Worker");
	});

	test("multiple messages preserve order", () => {
		const ast = parse(`sequenceDiagram
  Client->>Server: GET /shows
  Server-->>Client: 200 OK`);
		const msgs = messages(ast);
		expect(msgs).toHaveLength(2);
		expect(msgs[0]?.from).toBe("Client");
		expect(msgs[0]?.to).toBe("Server");
		expect(msgs[1]?.from).toBe("Server");
		expect(msgs[1]?.to).toBe("Client");
	});
});

// ─── Notes ───────────────────────────────────────────────────────────────────

describe("notes", () => {
	test("note over single actor", () => {
		const ast = parse(`sequenceDiagram
  participant DB
  note over DB: Warming up cache`);
		const note = ast.statements.find((s) => s.kind === "note");
		expect(note).toBeDefined();
		if (note?.kind !== "note") return;
		expect(note.position).toBe("over");
		expect(note.text).toBe("Warming up cache");
	});

	test("note left of", () => {
		const ast = parse(`sequenceDiagram
  participant DB
  note left of DB: Replica lag`);
		const note = ast.statements.find((s) => s.kind === "note");
		if (note?.kind !== "note") return;
		expect(note.position).toBe("left of");
	});

	test("note right of", () => {
		const ast = parse(`sequenceDiagram
  participant DB
  note right of DB: Primary node`);
		const note = ast.statements.find((s) => s.kind === "note");
		if (note?.kind !== "note") return;
		expect(note.position).toBe("right of");
	});
});

// ─── Activations ─────────────────────────────────────────────────────────────

describe("activations", () => {
	test("explicit activate / deactivate", () => {
		const ast = parse(`sequenceDiagram
  Client ->> Worker: Enqueue job
  activate Worker
  Worker -->> Client: Job accepted
  deactivate Worker`);
		const acts = ast.statements.filter((s) => s.kind === "activation");
		expect(acts).toHaveLength(2);
	});

	test("autonumber", () => {
		const ast = parse(`sequenceDiagram
  autonumber
  Client ->> Server: Connect`);
		expect(ast.statements.some((s) => s.kind === "autonumber")).toBe(true);
	});
});

// ─── Groups ───────────────────────────────────────────────────────────────────

describe("groups", () => {
	test("loop with body", () => {
		const ast = parse(`sequenceDiagram
  loop Poll interval
    Poller ->> Queue: Check for messages
  end`);
		const loop = ast.statements.find((s) => s.kind === "loop");
		expect(loop).toBeDefined();
		if (loop?.kind !== "loop") return;
		expect(loop.label).toBe("Poll interval");
		expect(loop.statements).toHaveLength(1);
	});

	test("alt with else branch", () => {
		const ast = parse(`sequenceDiagram
  alt token valid
    Gateway ->> Service: Forward request
  else token expired
    Gateway ->> Client: 401 Unauthorized
  end`);
		const alt = ast.statements.find((s) => s.kind === "alt");
		expect(alt).toBeDefined();
		if (alt?.kind !== "alt") return;
		expect(alt.branches).toHaveLength(2);
		expect(alt.branches[0]?.condition).toBe("token valid");
		expect(alt.branches[1]?.condition).toBe("token expired");
	});

	test("alt with multiple else branches", () => {
		const ast = parse(`sequenceDiagram
  alt 200 OK
    Client ->> App: Render response
  else 401 Unauthorized
    Client ->> App: Show login
  else 500 Server Error
    Client ->> App: Show error page
  end`);
		const alt = ast.statements.find((s) => s.kind === "alt");
		if (alt?.kind !== "alt") return;
		expect(alt.branches).toHaveLength(3);
	});

	test("par with and branch", () => {
		const ast = parse(`sequenceDiagram
  par send confirmation email
    Notifier ->> EmailService: Send email
  and send push notification
    Notifier ->> PushService: Send push
  end`);
		const par = ast.statements.find((s) => s.kind === "par");
		expect(par).toBeDefined();
		if (par?.kind !== "par") return;
		expect(par.branches).toHaveLength(2);
	});

	test("break block", () => {
		const ast = parse(`sequenceDiagram
  break connection lost
    Client ->> Client: Retry with backoff
  end`);
		expect(ast.statements.some((s) => s.kind === "break")).toBe(true);
	});

	test("rect block", () => {
		const ast = parse(`sequenceDiagram
  rect rgb(200,220,255)
    Client ->> Cache: Check cache
  end`);
		expect(ast.statements.some((s) => s.kind === "rect")).toBe(true);
	});

	test("nested loop inside alt", () => {
		const ast = parse(`sequenceDiagram
  alt connected
    loop heartbeat interval
      Client ->> Server: ping
    end
  end`);
		const alt = ast.statements.find((s) => s.kind === "alt");
		if (alt?.kind !== "alt") return;
		expect(alt.branches[0]?.statements.some((s) => s.kind === "loop")).toBe(
			true,
		);
	});
});

// ─── Metadata ────────────────────────────────────────────────────────────────

describe("metadata", () => {
	test("title is captured", () => {
		const ast = parse(`sequenceDiagram
  title Ticket Purchase Flow
  Client ->> API: POST /tickets`);
		expect(ast.title).toBe("Ticket Purchase Flow");
	});
});

// ─── Compatibility — parse-without-error fixtures ────────────────────────────
// Exercises the full range of plaintext sequence diagram syntax.
// The bar: valid input must parse without hard errors (warnings are acceptable).

// Named sources — defined once, referenced in FIXTURES and ROUND_TRIP_CASES.
const src = {
	twoParticipantRequestResponse: `sequenceDiagram
  Client->>API: GET /venues
  API-->>Client: 200 venues[]`,

	threeParticipantChain: `sequenceDiagram
  Browser->>Gateway: POST /login
  Gateway-->>Auth: Verify credentials
  Auth-->>Gateway: OK
  Gateway-->>Browser: Set-Cookie: session`,

	explicitDeclarationsThenMessages: `sequenceDiagram
  participant Browser
  participant Gateway
  participant DB
  Browser->>Gateway: GET /shows
  Gateway-->>Browser: 200`,

	aliasedParticipants: `sequenceDiagram
  participant B as Browser
  participant G as Gateway
  B->>G: Connect`,

	noteSpanningTwoParticipants: `sequenceDiagram
  Client->Server: Handshake
  note over Client,Server: TLS negotiation`,

	explicitActivateDeactivate: `sequenceDiagram
  Client->>Worker: Submit job
  activate Worker
  Worker-->>Client: Accepted
  deactivate Worker`,

	pollingLoop: `sequenceDiagram
  Client->Server: Connect
  loop every 30s
    Client->Server: Heartbeat
    Server->Client: Ack
  end`,

	conditionalBranch: `sequenceDiagram
  Client->>Auth: Login
  alt credentials valid
    Auth->>Client: Token
  else credentials invalid
    Auth->>Client: 401
  end`,

	parallelFanout: `sequenceDiagram
  par notify email
    Notifier->>Email: Send
  and notify sms
    Notifier->>SMS: Send
  end`,

	autonumberPrefix: `sequenceDiagram
  autonumber
  Client->>Server: Request
  Server->>Client: Response`,

	breakOnCircuitOpen: `sequenceDiagram
  break circuit open
    Client->>Fallback: Use cached data
  end`,

	rectHighlightRegion: `sequenceDiagram
  rect rgb(255,240,200)
    Client->>Cache: Read
  end`,

	leadingCommentIgnored: `%% Payment processing flow
sequenceDiagram
  Client->>Payments: Charge card`,

	selfReferencingMessage: `sequenceDiagram
  Scheduler->>Scheduler: Requeue failed jobs`,

	allDashedArrowVariants: `sequenceDiagram
  A-->B: open dashed
  A-->>B: filled dashed
  A--xB: cross dashed
  A--)B: async dashed`,

	// Round-trip sources
	requestAndResponse: `sequenceDiagram
  participant Client
  participant API
  Client ->> API: GET /shows
  API -->> Client: 200 shows[]`,

	pollingLoopRoundTrip: `sequenceDiagram
  loop Heartbeat interval
    Client ->> Server: Ping
  end`,

	authBranch: `sequenceDiagram
  alt authenticated
    Client ->> API: Proceed
  else unauthenticated
    Client ->> Auth: Redirect to login
  end`,
};

describe("compatibility — must parse without error", () => {
	const FIXTURES: [string, string][] = [
		["two-participant request/response", src.twoParticipantRequestResponse],
		["three participants with chained messages", src.threeParticipantChain],
		[
			"explicit declarations followed by messages",
			src.explicitDeclarationsThenMessages,
		],
		["participants with short-form aliases", src.aliasedParticipants],
		["note spanning two participants", src.noteSpanningTwoParticipants],
		["explicit activate and deactivate", src.explicitActivateDeactivate],
		["polling loop", src.pollingLoop],
		["conditional branch with alt/else", src.conditionalBranch],
		["parallel fanout with par", src.parallelFanout],
		["autonumber prefix", src.autonumberPrefix],
		["break on circuit open", src.breakOnCircuitOpen],
		["rect highlight region", src.rectHighlightRegion],
		["leading diagram comment is ignored", src.leadingCommentIgnored],
		["self-referencing message", src.selfReferencingMessage],
		["all dashed arrow variants in one diagram", src.allDashedArrowVariants],
	];

	for (const [description, source] of FIXTURES) {
		test(description, () => {
			const tokens = tokenize(source);
			const parser = new SequenceParser(tokens);
			parser.setSource(source.split("\n"));
			const result = parser.parse();
			// Warnings are acceptable; hard errors are not
			const hardErrors = result.ok
				? []
				: result.errors.filter((e) => e.severity === "error");
			expect(hardErrors).toHaveLength(0);
		});
	}
});

// ─── Round-trip: parse → toPlaintext → parse ─────────────────────────────────

describe("round-trip: parse → toPlaintext → parse", () => {
	const ROUND_TRIP_CASES: [string, string][] = [
		["request and response", src.requestAndResponse],
		["polling loop", src.pollingLoopRoundTrip],
		["auth branch", src.authBranch],
	];

	for (const [description, source] of ROUND_TRIP_CASES) {
		test(description, () => {
			const ast1 = parse(source);
			const plaintext = new SequenceRenderer(ast1).toPlaintext();
			const ast2 = parse(plaintext);

			// Structural equivalence — not byte-for-byte identical source
			expect(ast2.participants.length).toBe(ast1.participants.length);
			expect(ast2.statements.length).toBe(ast1.statements.length);
		});
	}
});

// ─── Error recovery ───────────────────────────────────────────────────────────

describe("error recovery", () => {
	test("unrecognised lines are skipped without halting the parse", () => {
		const tokens = tokenize(`sequenceDiagram
  Client ->> Server: Connect
  ??? garbage input ???
  Server -->> Client: Connected`);
		const result = new SequenceParser(tokens).parse();
		const ast = result.ok ? result.ast : result.partialAst;
		expect(ast).toBeDefined();
		if (!ast) return;

		const msgs = ast.statements.filter((s) => s.kind === "message");
		expect(msgs.length).toBeGreaterThanOrEqual(1);
	});
});
