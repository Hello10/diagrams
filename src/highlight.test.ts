import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { highlight } from "./api.ts";
import { Diagram } from "./Diagram.ts";
import {
	clearRegistry,
	getRegisteredDiagrams,
	registerDiagram,
} from "./registry.ts";
import { tokenize } from "./tokenizer.ts";

const examples = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../examples/diagrams",
);
const NAMES = ["ui", "flowchart", "sequence", "state", "class"];
const read = (name: string) =>
	readFileSync(resolve(examples, `${name}.txt`), "utf8");

/** Each span as `kind:text`, the way a reader would check it. */
function spans(source: string): string[] {
	return highlight(source).map(
		(s) => `${s.kind}:${source.slice(s.from, s.to)}`,
	);
}
/** The spans of the one line in `source` containing `needle`. */
function line(source: string, needle: string): string[] {
	const number = source.split("\n").findIndex((l) => l.includes(needle)) + 1;
	expect(number).toBeGreaterThan(0);
	return highlight(source)
		.filter((s) => s.line === number)
		.map((s) => `${s.kind}:${source.slice(s.from, s.to)}`);
}
/** Ordered, non-overlapping, in bounds, and columns agree with offsets. Plain
 * checks rather than an expect per span: the half-typed test runs this a lot. */
function expectWellFormed(source: string) {
	const lines = source.split("\n");
	let previous = 0;
	for (const s of highlight(source)) {
		const text = lines[s.line - 1] ?? "";
		const ok =
			s.from >= previous &&
			s.to > s.from &&
			s.to <= source.length &&
			s.endCol - 1 <= text.length &&
			source.slice(s.from, s.to) === text.slice(s.col - 1, s.endCol - 1);
		if (!ok)
			expect.fail(
				`bad span ${JSON.stringify(s)} in ${JSON.stringify(source.slice(0, 200))}`,
			);
		previous = s.to;
	}
}

describe("token end positions", () => {
	const ends = (source: string, type: string) =>
		tokenize(source)
			.filter((t) => t.type === type)
			.map((t) => source.slice(t.col - 1, t.endCol - 1));

	test("each token's range is its source text, not its stripped value", () => {
		expect(ends('Text "hi there"', "string")).toEqual(['"hi there"']);
		expect(ends('Text "unclosed', "string")).toEqual(['"unclosed']);
		expect(ends("%% a note  ", "comment")).toEqual(["%% a note"]);
		expect(ends("%%{theme ink=#fff}%%", "directive")).toEqual([
			"%%{theme ink=#fff}%%",
		]);
		expect(ends('a placeholder="x y" b=c', "attribute")).toEqual([
			'placeholder="x y"',
			"b=c",
		]);
		expect(ends("Input #query", "hash")).toEqual(["#query"]);
		expect(ends("in ~band.error", "tilde")).toEqual(["~band.error"]);
		expect(ends("A -->|yes| B", "labeled-arrow")).toEqual(["-->|yes|"]);
	});
});

describe("highlight", () => {
	test("ui: keywords, names, sigils, flags, and data", () => {
		const src = read("ui");
		expect(line(src, 'Button "Sign in" primary')).toEqual([
			"keyword:else",
			"operator:=>",
			"type:Button",
			'string:"Sign in"',
			"property:primary",
			"event:$click",
			"operator:=>",
			"operation:~signIn",
		]);
		expect(line(src, "screen Band route=")).toEqual([
			"keyword:screen",
			"type:Band",
			"property:route",
			"data:/bands/:id",
			"property:layout",
			"data:AppShell",
			"mode:@shows",
			"mode:@albums",
			"mode:@about",
		]);
		expect(line(src, "TrackRow(track) $select")).toEqual([
			"type:TrackRow",
			"data:(track)",
			"event:$select",
			"data:(picked)",
			"operator:=>",
			"mode:@playing",
			"data:(picked)",
		]);
		expect(line(src, "list tracks as track")).toEqual([
			"keyword:list",
			"data:tracks",
			"keyword:as",
			"data:track",
		]);
		expect(line(src, "ready => go Search")).toEqual([
			"mode:ready",
			"operator:=>",
			"keyword:go",
			"type:Search",
		]);
		expect(line(src, 'Link "Search"  #search')).toEqual([
			"type:Link",
			'string:"Search"',
			"handle:#search",
			"property:to",
			"data:Search",
		]);
		expect(line(src, 'api "@gigs/api" signIn')).toEqual([
			"keyword:api",
			'string:"@gigs/api"',
			"operation:signIn",
			"operation:signOut",
			"operation:follow",
			"operation:order",
			"operation:saveProfile",
			"operation:cancelTicket",
		]);
	});

	test("ui: an interpolation inside a string is data", () => {
		expect(
			spans('ui\n  screen A route=/\n    Text "Hi {user.name}!"\n  end\nend'),
		).toContain("data:{user.name}");
		expect(
			spans('ui\n  screen A route=/\n    Text "Hi {user.name}!"\n  end\nend'),
		).toContain('string:"Hi ');
	});

	test("sequence: free text after the colon is one label", () => {
		const src = read("sequence");
		expect(line(src, "POST /auth/login")).toEqual([
			"type:B",
			"operator:->>",
			"type:A",
			"label:POST /auth/login",
		]);
		expect(line(src, "participant A as Auth Service")).toEqual([
			"keyword:participant",
			"type:A",
			"keyword:as",
			"label:Auth Service",
		]);
		expect(line(src, "alt Credentials valid")).toEqual([
			"keyword:alt",
			"label:Credentials valid",
		]);
		expect(line(src, "note over A, DB")).toEqual([
			"keyword:note",
			"keyword:over",
			"type:A",
			"type:DB",
			"label:Audit trail written",
		]);
		expect(line(src, "title User sign-in")).toEqual([
			"keyword:title",
			"label:User sign-in flow",
		]);
	});

	test("state: markers, labels, and multi-line notes", () => {
		const src = read("state");
		expect(line(src, "stateDiagram-v2")).toEqual(["keyword:stateDiagram-v2"]);
		expect(line(src, "Pending --> Active")).toEqual([
			"type:Pending",
			"operator:-->",
			"type:Active",
			"label:payment received",
		]);
		expect(line(src, "[*] --> Pending")).toEqual([
			"keyword:[*]",
			"operator:-->",
			"type:Pending",
		]);
		expect(line(src, 'state "Awaiting')).toEqual([
			"keyword:state",
			'string:"Awaiting Approval"',
			"keyword:as",
			"type:Pending",
		]);
		expect(line(src, "All resources released")).toEqual([
			"label:All resources released.",
		]);
		expect(line(src, "end note")).toEqual(["keyword:end note"]);
	});

	test("flowchart: nodes, shape labels, and arrow labels", () => {
		const src = read("flowchart");
		expect(line(src, "flowchart TD")).toEqual([
			"keyword:flowchart",
			"keyword:TD",
		]);
		expect(line(src, "Auth -->|no| Reject")).toEqual([
			"type:Auth",
			"operator:-->",
			"label:|no|",
			"type:Reject",
			"label:[/Return 401 Unauthorized/]",
		]);
		expect(line(src, "subgraph Validate")).toEqual([
			"keyword:subgraph",
			"type:Validate",
			"label:[Validation]",
		]);
	});

	test("class: declarations, members, and generics", () => {
		const src = read("class");
		expect(line(src, "class Product {")).toEqual([
			"keyword:class",
			"type:Product",
		]);
		expect(line(src, "+reserve(int quantity) bool")).toEqual([
			"property:+reserve(int quantity) bool",
		]);
		expect(line(src, "<<aggregate root>>")).toEqual([
			"keyword:<<aggregate root>>",
		]);
		expect(line(src, "namespace Catalog")).toEqual([
			"keyword:namespace",
			"type:Catalog",
		]);
	});

	test("comments and directives are recognized in every diagram", () => {
		for (const head of [
			"ui",
			"flowchart TD",
			"sequenceDiagram",
			"stateDiagram",
			"classDiagram",
		]) {
			expect(spans(`${head}\n  %% a note\n  %%{theme}%%`)).toEqual(
				expect.arrayContaining(["comment:%% a note", "directive:%%{theme}%%"]),
			);
		}
	});

	test("offsets and columns point at the same text, across lines", () => {
		const src = 'ui\n  use "x" A\n';
		const span = highlight(src).find((s) => s.kind === "string");
		expect(span).toMatchObject({
			line: 2,
			col: 7,
			endCol: 10,
			from: 9,
			to: 12,
		});
	});

	test("every example is well formed and fully classified", () => {
		for (const name of NAMES) {
			const src = read(name);
			expectWellFormed(src);
			// No word that means something is left unclassified, apart from
			// punctuation the grammars read structurally.
			const covered = highlight(src);
			for (const t of tokenize(src)) {
				if (t.type !== "identifier" || /^[{}:;,-]$/.test(t.value)) continue;
				const hit = covered.some(
					(s) => s.line === t.line && s.col <= t.col && s.endCol >= t.endCol,
				);
				expect(hit, `${name} L${t.line}:${t.col} ${t.value}`).toBe(true);
			}
		}
	});

	test("half-typed source: never throws, always well formed", () => {
		for (const name of NAMES) {
			const src = read(name);
			// Cut anywhere, as a person typing would leave it.
			for (let end = 0; end < src.length; end += 11) {
				expectWellFormed(src.slice(0, end));
			}
			// Lose a run from the middle, leaving blocks and strings unbalanced.
			for (let at = 0; at < src.length; at += 37) {
				expectWellFormed(src.slice(0, at) + src.slice(at + 23));
			}
		}
	});

	test("edge sources", () => {
		for (const src of [
			"",
			"\n",
			"   ",
			"%%",
			'"',
			"=",
			"|",
			"ui",
			"unknown thing",
			"a\r\nb",
		]) {
			expectWellFormed(src);
		}
		expect(highlight("")).toEqual([]);
	});

	test("a source of no known type gets the lexical layer", () => {
		expect(spans('whatever "text" --> %% no\n%% note')).toEqual([
			'string:"text"',
			"operator:-->",
			"comment:%% note",
		]);
	});

	test("a registered diagram without a classifier still gets the lexical layer", () => {
		class Plain extends Diagram {
			readonly type = "plain";
			readonly name = "Plain";
			detect(firstLine: string) {
				return firstLine === "plain";
			}
			parse() {
				return { ok: true as const, ast: { type: "plain" } };
			}
			render() {
				return "";
			}
			toPlaintext() {
				return "";
			}
		}
		const before = getRegisteredDiagrams();
		registerDiagram(new Plain());
		try {
			expect(spans('plain\n  word "text"')).toEqual(['string:"text"']);
		} finally {
			clearRegistry();
			for (const d of before) registerDiagram(d);
		}
	});
});
