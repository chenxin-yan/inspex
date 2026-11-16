import { describe, expect, it } from "vite-plus/test";

import { locateJsonPointers, parseJsonc, pointerKey, stripJsonc } from "./jsonc.ts";

describe("parseJsonc", () => {
	it("parses plain JSON", () => {
		expect(parseJsonc('{ "a": [1, "x"] }')).toEqual({ ok: true, value: { a: [1, "x"] } });
	});

	it("allows comments and trailing commas, but not inside strings", () => {
		const text = `// head
{
	/* block
	   comment */ "a": "// not a comment, /* nor this */",
	"b": [1, 2, /* x */ ], // tail
	"c": { "d": "\\" , }", },
}`;
		expect(parseJsonc(text)).toEqual({
			ok: true,
			value: { a: "// not a comment, /* nor this */", b: [1, 2], c: { d: '" , }' } },
		});
	});

	it("skips a byte order mark", () => {
		expect(parseJsonc('\uFEFF{ "a": 1, }')).toEqual({ ok: true, value: { a: 1 } });
	});

	it("reports a syntax error with its offset", () => {
		const text = '{\n\t"a": 1\n\t"b": 2\n}';
		expect(parseJsonc(text)).toEqual({
			ok: false,
			error: { message: "Expected ',' or '}'.", start: text.indexOf('"b"'), length: 1 },
		});
	});

	it.each([
		["/* open", "Unterminated block comment."],
		['{ "a": "open', "Unterminated string."],
		['{ "a": 1', "Unexpected end of file: '}' is missing."],
		["{ a: 1 }", "Expected a property name in double quotes."],
		['{ "a": tru }', "Unexpected character 't': expected a value."],
		['{ "a": 1 } x', "Unexpected text after the end of the document."],
		["", "Unexpected end of file: a value is missing."],
	])("reports %j", (text, message) => {
		const result = parseJsonc(text);
		expect(result.ok ? undefined : result.error.message).toBe(message);
	});
});

describe("stripJsonc", () => {
	it("keeps every offset and line break", () => {
		const text = '{ "a": 1, // x\n "b": [2,], /* y\n */ }';
		const stripped = stripJsonc(text) as string;
		expect(stripped).toHaveLength(text.length);
		expect(stripped.split("\n")).toHaveLength(3);
		expect(JSON.parse(stripped)).toEqual({ a: 1, b: [2] });
	});
});

describe("locateJsonPointers", () => {
	it("finds values by pointer in one pass, skipping comments", () => {
		const text = '{ /* "a": 0 */ "a": { "b/c": [10, { "d": "x" }] } }';
		const found = locateJsonPointers(text, [["a", "b/c", "1", "d"], ["a"], ["missing"]]);
		expect(found.get(pointerKey(["a", "b/c", "1", "d"]))).toEqual({
			start: text.indexOf('"x"'),
			length: 3,
		});
		expect(found.get(pointerKey(["a"]))?.start).toBe(text.indexOf('{ "b/c"'));
		expect(found.has(pointerKey(["missing"]))).toBe(false);
	});
});
