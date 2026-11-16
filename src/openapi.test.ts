// Type shapes are compared with openapi-typescript in tests/differential.test.ts; these tests cover what
// the oracle cannot: problems, and the places where inspex deliberately differs.
import { describe, expect, it } from "vite-plus/test";

import { generateOpenApiTypes, ProblemCode } from "./openapi.ts";

const doc = (extra: Record<string, unknown>) => ({
	openapi: "3.1.0",
	info: { title: "t", version: "1" },
	...extra,
});
const get = (operationId?: string) => ({
	get: { operationId, responses: { 200: { description: "ok" } } },
});

describe("documents that cannot be typed", () => {
	it.each([
		[[], [[], "An OpenAPI document must be a JSON object."]],
		[
			{ swagger: "2.0" },
			[["swagger"], "Swagger 2.0 is not supported: convert the document to OpenAPI 3.0 or 3.1."],
		],
		[
			{ openapi: "3.2.0" },
			[["openapi"], 'Unsupported OpenAPI version "3.2.0": inspex supports OpenAPI 3.0 and 3.1.'],
		],
		[{ info: {} }, [[], "Unsupported OpenAPI version null: inspex supports OpenAPI 3.0 and 3.1."]],
	])("%j", (input, [pointer, message]) => {
		expect(generateOpenApiTypes(input)).toEqual({
			text: undefined,
			problems: [{ pointer, message, code: ProblemCode.UnsupportedDocument }],
		});
	});
});

describe("a broken part of a spec", () => {
	it("keeps the first of two operations with one operationId in operations", () => {
		const { text, problems } = generateOpenApiTypes(
			doc({ paths: { "/a": get("same"), "/b": get("same") } }),
		);
		expect(problems).toEqual([
			{
				pointer: ["paths", "/b", "get", "operationId"],
				code: ProblemCode.DuplicateOperationId,
				message:
					'Duplicate operationId "same", first used at #/paths/~1a/get/operationId; this operation is typed inline in paths and left out of operations (at #/paths/~1b/get/operationId)',
			},
		]);
		expect(text).toContain('get: operations["same"];');
		expect(text?.match(/^same: \{/gm)).toHaveLength(1);
	});

	it.each([
		[
			"#/components/schemas/Missing",
			ProblemCode.UnresolvableRef,
			'Cannot resolve $ref "#/components/schemas/Missing"',
		],
		["other.json#/A", ProblemCode.UnsupportedRef, 'External $ref "other.json#/A" is not supported'],
		["#/paths/~1a", ProblemCode.UnsupportedRef, '$ref "#/paths/~1a" is not supported'],
		[
			"#/components/schemas/A/items",
			ProblemCode.UnsupportedRef,
			'$ref "#/components/schemas/A/items" is not supported',
		],
	])("types $ref %s as unknown and reports it", (ref, code, message) => {
		const { text, problems } = generateOpenApiTypes(
			doc({
				paths: { "/a": get("a") },
				components: {
					schemas: {
						A: { type: "array", items: {} },
						B: { type: "object", properties: { x: { $ref: ref } } },
					},
				},
			}),
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.pointer).toEqual(["components", "schemas", "B", "properties", "x", "$ref"]);
		expect(problems[0]?.code).toBe(code);
		expect(problems[0]?.message).toContain(message);
		expect(text).toContain("x?: unknown;");
	});

	it("leaves out a parameter whose $ref cannot be resolved", () => {
		const { text, problems } = generateOpenApiTypes(
			doc({
				paths: {
					"/a": { get: { parameters: [{ $ref: "#/components/parameters/Nope" }], responses: {} } },
				},
			}),
		);
		expect(problems.map((p) => p.pointer)).toEqual([
			["paths", "/a", "get", "parameters", "0", "$ref"],
		]);
		expect(text).toContain("query?: never;");
	});

	it("reports a value that is not a schema and types it as unknown", () => {
		const { text, problems } = generateOpenApiTypes(
			doc({ components: { schemas: { A: { type: "object", properties: { x: "string" } } } } }),
		);
		expect(problems.map((p) => [p.pointer, p.code])).toEqual([
			[["components", "schemas", "A", "properties", "x"], ProblemCode.InvalidValue],
		]);
		expect(text).toContain("x?: unknown;");
	});
});

describe("deliberate differences from openapi-typescript", () => {
	it("emits an empty operations interface when no operation has an operationId", () => {
		const { text } = generateOpenApiTypes(doc({ paths: { "/a": get() } }));
		expect(text).toContain("export interface operations {\n\n}");
	});

	it("types an object without properties as Record<string, unknown>", () => {
		const { text } = generateOpenApiTypes(
			doc({ components: { schemas: { A: { type: "object" } } } }),
		);
		expect(text).toContain("A: Record<string, unknown>;");
	});

	it("gives schemas on an eager reference cycle a type alias, so they are not circular", () => {
		const { text } = generateOpenApiTypes(
			doc({
				components: {
					schemas: {
						Json: {
							anyOf: [
								{ type: "array", items: { $ref: "#/components/schemas/Json" } },
								{ type: "string" },
							],
						},
						A: { type: "array", items: { $ref: "#/components/schemas/B" } },
						B: { oneOf: [{ $ref: "#/components/schemas/A" }, { type: "number" }] },
						Tree: {
							type: "object",
							properties: {
								children: { type: "array", items: { $ref: "#/components/schemas/Tree" } },
							},
						},
					},
				},
			}),
		);
		expect(text).toContain("Json: $schema_Json;");
		expect(text).toContain("type $schema_Json = $schema_Json[] | string;");
		expect(text).toContain("type $schema_A = $schema_B[];");
		expect(text).toContain("type $schema_B = $schema_A | number;");
		// Through an object property, recursion is lazy and needs no alias.
		expect(text).toContain('children?: components["schemas"]["Tree"][];');
	});
});

it("exports the read/write helpers only with readWriteMarkers", () => {
	const input = () =>
		doc({
			components: {
				schemas: { A: { type: "object", properties: { id: { type: "string", readOnly: true } } } },
			},
		});
	const plain = generateOpenApiTypes(input()).text;
	const markers = generateOpenApiTypes(input(), { readWriteMarkers: true }).text;
	expect(plain).toContain("readonly id?: string;");
	expect(plain).not.toContain("$Read");
	expect(markers).toContain("id?: $Read<string>;");
	expect(markers).toContain("export type Readable<T>");
	expect(markers).toContain("export type Writable<T>");
});
