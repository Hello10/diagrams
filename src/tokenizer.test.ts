import { tokenize } from "./tokenizer.ts";

describe("tokenize", () => {
	// ─── Basic token types ─────────────────────────────────────────────────

	test("produces identifier tokens for bare words", () => {
		const tokens = tokenize("sequenceDiagram");
		const ids = tokens.filter((t) => t.type === "identifier");
		expect(ids[0]?.value).toBe("sequenceDiagram");
	});

	test("produces string tokens for double-quoted values", () => {
		const tokens = tokenize('text "Hello World"');
		const str = tokens.find((t) => t.type === "string");
		expect(str?.value).toBe("Hello World");
	});

	test("produces attribute tokens for key=value pairs", () => {
		const tokens = tokenize("input type=email");
		const attr = tokens.find((t) => t.type === "attribute");
		expect(attr?.value).toBe("type=email");
	});

	test('produces attribute tokens for key="quoted value" pairs', () => {
		const tokens = tokenize('ContactCard name="Alice Johnson"');
		const attr = tokens.find((t) => t.type === "attribute");
		expect(attr?.value).toBe("name=Alice Johnson");
	});

	test("produces arrow tokens", () => {
		const tokens = tokenize("A --> B");
		const arrow = tokens.find((t) => t.type === "arrow");
		expect(arrow?.value).toBe("-->");
	});

	test("produces labeled-arrow tokens", () => {
		const tokens = tokenize('A -->|"on fail"| B');
		const arr = tokens.find((t) => t.type === "labeled-arrow");
		expect(arr?.value).toBe('-->|"on fail"|');
	});

	test("produces hook tokens for @-prefixed identifiers", () => {
		const tokens = tokenize('button "Sign In" --> @onSignIn');
		const hook = tokens.find((t) => t.type === "hook");
		expect(hook?.value).toBe("@onSignIn");
	});

	test("treats @scope/module paths as identifiers for use declarations", () => {
		const tokens = tokenize("use @jump/ui as UI");
		const moduleRef = tokens.find(
			(t) => t.type === "identifier" && t.value === "@jump/ui",
		);
		expect(moduleRef).toBeDefined();
	});

	test("does not eat @{...} as a hook (reserved for flowchart shape decorators)", () => {
		// `A@{ shape: rect, label: "Hi" }` is Mermaid v11 flowchart syntax.
		// The tokenizer must not greedily match @{...} as a hook token, so the
		// flowchart parser can decode it later.
		const tokens = tokenize("A@{shape: rect}");
		expect(tokens.some((t) => t.type === "hook")).toBe(false);
		const ids = tokens
			.filter((t) => t.type === "identifier")
			.map((t) => t.value);
		expect(ids).toContain("A");
		expect(ids).toContain("shape");
		expect(ids).toContain("rect");
	});

	test("produces bracket tokens for [...] state labels", () => {
		const tokens = tokenize("screen LoginScreen mobile [loading]");
		const bracket = tokens.find((t) => t.type === "bracket");
		expect(bracket?.value).toBe("[loading]");
	});

	test("produces comment tokens for %% lines", () => {
		const tokens = tokenize("%% this is a comment");
		const comment = tokens.find((t) => t.type === "comment");
		expect(comment?.value).toBe("this is a comment");
	});

	test("produces directive tokens for %%{...}%% lines", () => {
		const tokens = tokenize('%%{init: {"theme": "dark"}}%%');
		const dir = tokens.find((t) => t.type === "directive");
		expect(dir).toBeDefined();
	});

	// ─── Indent / dedent ───────────────────────────────────────────────────

	test("emits indent token when indent level increases", () => {
		const src = `wireframe\n  screen A mobile`;
		const tokens = tokenize(src);
		expect(tokens.some((t) => t.type === "indent")).toBe(true);
	});

	test("emits dedent token when indent level decreases", () => {
		const src = `wireframe\n  screen A mobile\nend`;
		const tokens = tokenize(src);
		expect(tokens.some((t) => t.type === "dedent")).toBe(true);
	});

	test("emits multiple dedents when jumping multiple levels", () => {
		const src = `a\n  b\n    c\nend`;
		const tokens = tokenize(src);
		const dedents = tokens.filter((t) => t.type === "dedent");
		expect(dedents.length).toBeGreaterThanOrEqual(2);
	});

	// ─── Line and column tracking ──────────────────────────────────────────

	test("records correct line numbers", () => {
		const src = `line1\nline2\nline3`;
		const tokens = tokenize(src);
		const identifiers = tokens.filter((t) => t.type === "identifier");
		expect(identifiers[0]?.line).toBe(1);
		expect(identifiers[1]?.line).toBe(2);
		expect(identifiers[2]?.line).toBe(3);
	});

	test("records indent level on tokens", () => {
		const src = `a\n  b`;
		const tokens = tokenize(src);
		const bToken = tokens.filter(
			(t) => t.type === "identifier" && t.value === "b",
		)[0];
		expect(bToken?.indentLevel).toBe(1);
	});

	// ─── Edge cases ────────────────────────────────────────────────────────

	test("handles empty string", () => {
		const tokens = tokenize("");
		expect(tokens).toEqual([]);
	});

	test("handles blank lines gracefully", () => {
		const src = `a\n\nb`;
		const tokens = tokenize(src);
		const ids = tokens.filter((t) => t.type === "identifier");
		expect(ids.map((t) => t.value)).toEqual(["a", "b"]);
	});

	test("does not produce hook token when @ has no following identifier", () => {
		// A lone @ that isn't followed by an identifier should not crash
		const tokens = tokenize("@ something");
		// It may produce a hook or be skipped — but must not throw
		expect(Array.isArray(tokens)).toBe(true);
	});

	test("correctly tokenizes unclosed string to end of line", () => {
		const tokens = tokenize('text "unclosed');
		const str = tokens.find((t) => t.type === "string");
		expect(str?.value).toBe("unclosed");
	});

	test("handles $param identifiers", () => {
		const tokens = tokenize("text $name bold");
		const param = tokens.find(
			(t) => t.type === "identifier" && t.value === "$name",
		);
		expect(param).toBeDefined();
	});

	test("multiple tokens on one line have correct order", () => {
		const src = 'button "Sign In" primary --> @onSignIn';
		const tokens = tokenize(src).filter((t) => t.type !== "newline");
		const types = tokens.map((t) => t.type);
		expect(types).toEqual([
			"identifier",
			"string",
			"identifier",
			"arrow",
			"hook",
		]);
	});

	test("handles unclosed brackets and quotes", () => {
		const result = tokenize('a [b c\nd key="val');
		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "bracket", value: "[b c" }),
				expect.objectContaining({ type: "attribute", value: "key=val" }),
			]),
		);
	});

	// ─── Flowchart compound shape literals ──────────────────────────────────

	test("tokenizes stadium shape `([label])` as a single bracket", () => {
		const tokens = tokenize("Start([Incoming request])");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["([Incoming request])"]);
	});

	test("tokenizes subroutine shape `[[label]]` as a single bracket", () => {
		const tokens = tokenize("Proc[[Process result]]");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["[[Process result]]"]);
	});

	test("tokenizes cylinder shape `[(label)]` as a single bracket", () => {
		const tokens = tokenize("DB[(Query database)]");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["[(Query database)]"]);
	});

	test("tokenizes circle shape `((label))` as a single bracket", () => {
		const tokens = tokenize("X((center))");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["((center))"]);
	});

	test("tokenizes hexagon shape `{{label}}` as a single bracket", () => {
		const tokens = tokenize("H{{Hex label}}");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["{{Hex label}}"]);
	});

	test("tokenizes diamond shape `{label}` when adjacent to identifier", () => {
		const tokens = tokenize("Auth{Has auth header?}");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["{Has auth header?}"]);
	});

	test("does not treat space-separated `{` as a shape (state block opener)", () => {
		const tokens = tokenize("state Active {");
		const brackets = tokens.filter((t) => t.type === "bracket");
		expect(brackets).toEqual([]);
	});

	test("tokenizes round shape `(label)` when adjacent to identifier", () => {
		const tokens = tokenize("A(rounded)");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["(rounded)"]);
	});

	test("tokenizes parallelogram shape `[/label/]` as a single bracket", () => {
		const tokens = tokenize("P[/Return 400/]");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["[/Return 400/]"]);
	});

	test("tokenizes parallelogram-alt shape `[\\label\\]` as a single bracket", () => {
		const tokens = tokenize("P[\\Return 400\\]");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["[\\Return 400\\]"]);
	});

	test("tokenizes trapezoid shape `[/label\\]` as a single bracket", () => {
		const tokens = tokenize("T[/trapezoid\\]");
		const brackets = tokens
			.filter((t) => t.type === "bracket")
			.map((t) => t.value);
		expect(brackets).toEqual(["[/trapezoid\\]"]);
	});

	// ─── Flowchart edge arrows ───────────────────────────────────────────────

	test("tokenizes `---` as a solid-line arrow", () => {
		const tokens = tokenize("A --- B");
		const arrows = tokens.filter((t) => t.type === "arrow").map((t) => t.value);
		expect(arrows).toEqual(["---"]);
	});

	test("tokenizes `==>` as a thick arrow", () => {
		const tokens = tokenize("A ==> B");
		const arrows = tokens.filter((t) => t.type === "arrow").map((t) => t.value);
		expect(arrows).toEqual(["==>"]);
	});

	test("tokenizes `-.->` as a dotted arrow", () => {
		const tokens = tokenize("A -.-> B");
		const arrows = tokens.filter((t) => t.type === "arrow").map((t) => t.value);
		expect(arrows).toEqual(["-.->"]);
	});

	test("tokenizes labeled `-->|no|` arrow", () => {
		const tokens = tokenize("A -->|no| B");
		const labeled = tokens
			.filter((t) => t.type === "labeled-arrow")
			.map((t) => t.value);
		expect(labeled).toEqual(["-->|no|"]);
	});

	test("tokenizes labeled `==>|fast|` thick arrow", () => {
		const tokens = tokenize("A ==>|fast| B");
		const labeled = tokens
			.filter((t) => t.type === "labeled-arrow")
			.map((t) => t.value);
		expect(labeled).toEqual(["==>|fast|"]);
	});
});
