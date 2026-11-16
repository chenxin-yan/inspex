import { describe, expect, it } from "vite-plus/test";

import { formatOf } from "./formats.ts";
import { ProblemCode } from "./openapi.ts";

describe("formatOf", () => {
	it.each([
		["/a/acme.openapi.jsonc", "acme"],
		["C:\\specs\\Acme.OpenAPI.JSONC", "Acme"],
		["/a/my.api.v2.openapi.jsonc", "my.api.v2"],
	])("names %s %s", (fileName, name) => {
		expect(formatOf(fileName)?.name).toBe(name);
	});

	it.each(["/a/acme.openapi.yaml", "/a/acme.openapi.yml", "/a/acme.jsonc", "/a/acme.openapi.json"])(
		"has no format for %s",
		(fileName) => {
			expect(formatOf(fileName)).toBeUndefined();
		},
	);
});

describe("the .openapi.jsonc format", () => {
	const map = (content: string) =>
		formatOf("x.openapi.jsonc")?.format.map(content, { readWriteMarkers: false });

	it("reports a JSONC syntax error at its offset, without types", () => {
		expect(map('{ "openapi": }')).toEqual({
			text: undefined,
			problems: [
				{
					start: 13,
					length: 1,
					code: ProblemCode.InvalidSyntax,
					message: "Invalid JSONC: Unexpected character '}': expected a value.",
				},
			],
		});
	});

	it("locates a problem at the value its pointer names, and an object by its opening bracket", () => {
		const content = `{
	"openapi": "3.1.0",
	"paths": { "/a": { "get": { "responses": { "200": { "$ref": "#/nope" } } } } },
	// comments do not move positions
	"components": { "schemas": { "A": { "properties": { "x": 5 } } } }
}`;
		const problems = map(content)?.problems ?? [];
		expect(
			problems.map(({ start, length, code }) => [content.slice(start, start + length), code]),
		).toEqual([
			['"#/nope"', ProblemCode.UnresolvableRef],
			["5", ProblemCode.InvalidValue],
		]);
	});
});
