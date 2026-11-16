// Type shapes are compared with openapi-typescript in tests/differential.test.ts; these tests cover what
// the oracle cannot: problems, and the places where inspex deliberately differs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { parseJsonc } from "../../jsonc.ts";
import { ProblemCode } from "../../problems.ts";
import { generateOpenApiTypes } from "./index.ts";

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
		["#/paths/~1a", ProblemCode.UnsupportedRef, '$ref "#/paths/~1a" does not point to a schema'],
		[
			"#/components/schemas/A/type",
			ProblemCode.UnsupportedRef,
			'$ref "#/components/schemas/A/type" does not point to a schema',
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

	it("reports a path item that is not an object", () => {
		const { text, problems } = generateOpenApiTypes(doc({ paths: { "/bad": 42, "/a": get("a") } }));
		expect(problems.map((p) => [p.pointer, p.code])).toEqual([
			[["paths", "/bad"], ProblemCode.InvalidValue],
		]);
		expect(text).toContain('"/a": {');
		expect(text).not.toContain('"/bad"');
	});

	it("reports every unresolved parameter reference, and a parameter without a name or location", () => {
		const { problems } = generateOpenApiTypes(
			doc({
				paths: {
					"/a": {
						parameters: [{ $ref: "#/components/parameters/One" }],
						get: {
							parameters: [
								{ $ref: "#/components/parameters/Two" },
								{ $ref: "#/components/parameters/Three" },
								{ name: "x", in: "body", schema: { type: "string" } },
							],
							responses: {},
						},
					},
				},
			}),
		);
		expect(problems.map((p) => [p.pointer.join("/"), p.code])).toEqual([
			["paths//a/parameters/0/$ref", ProblemCode.UnresolvableRef],
			["paths//a/get/parameters/0/$ref", ProblemCode.UnresolvableRef],
			["paths//a/get/parameters/1/$ref", ProblemCode.UnresolvableRef],
			["paths//a/get/parameters/2", ProblemCode.InvalidValue],
		]);
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

describe("limits inherited from openapi-typescript", () => {
	it("ignores the siblings of a 3.1 $ref", () => {
		const { text } = generateOpenApiTypes(
			doc({
				components: {
					schemas: {
						A: { type: "object", properties: { id: { type: "string" } } },
						B: {
							$ref: "#/components/schemas/A",
							required: ["id"],
							properties: { name: { type: "string" } },
						},
					},
				},
			}),
		);
		expect(text).toContain('B: components["schemas"]["A"];');
	});

	it("types { const: null } as unknown", () => {
		const { text } = generateOpenApiTypes(doc({ components: { schemas: { N: { const: null } } } }));
		expect(text).toContain("N: unknown;");
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

function fixture(name: string): unknown {
	const parsed = parseJsonc(
		readFileSync(
			join(
				import.meta.dirname,
				"..",
				"..",
				"..",
				"tests",
				"fixtures",
				"openapi",
				"generator",
				name,
			),
			"utf8",
		),
	);
	if (!parsed.ok) throw new Error(parsed.error.message);
	return parsed.value;
}

/** The type of each component schema, as emitted on its member line. */
function schemaTypes(text: string | undefined): Map<string, string> {
	const start = text?.indexOf("export interface components {") ?? -1;
	const schemas = text?.slice(start, text.indexOf("\nresponses:", start)) ?? "";
	return new Map(
		[...schemas.matchAll(/^("?[\w$]+"?): ([^\n]*);$/gm)].map((m) => [
			m[1] as string,
			m[2] as string,
		]),
	);
}

describe("$refs into schemas follow the document's structure, not segment names", () => {
	const { text, problems } = generateOpenApiTypes(fixture("schema-positions.openapi.jsonc"));
	const types = schemaTypes(text);

	it.each([
		["RefSchemaItems", "string"],
		["RefSchemaProperties", "number"],
		["RefPropertiesItems", "boolean"],
		["RefItemsSchema", "number"],
		["RefResponse", "string"],
		["RefParameter", "string"],
		["RefParameterContent", "number"],
		["RefHeader", "boolean"],
		["RefRequestBody", "string"],
		["RefPathItem", "number"],
		["RefPathParameter", "string"],
		["RefExample", "unknown"],
		["RefParameterObject", "unknown"],
		["RefParameterName", "unknown"],
		["RefSchemaPropertiesMap", "unknown"],
	])("%s is %s", (name, type) => {
		expect(types.get(name)).toBe(type);
	});

	it("reports each $ref that does not reach a schema", () => {
		expect(problems.map((p) => [p.pointer.join("/"), p.code])).toEqual(
			["RefExample", "RefParameterObject", "RefParameterName", "RefSchemaPropertiesMap"].map(
				(name) => [`components/schemas/${name}/$ref`, ProblemCode.UnsupportedRef],
			),
		);
	});
});

it("reports a recursive schema reached by a $ref into another schema as unknown, with an accurate message", () => {
	const { text, problems } = generateOpenApiTypes(fixture("inline-recursion.openapi.jsonc"));
	expect(problems.map((p) => [p.pointer.join("/"), p.code])).toEqual([
		["components/schemas/A/$defs/Node/properties/next/$ref", ProblemCode.RefCycle],
	]);
	expect(problems[0]?.message).toBe(
		'$ref "#/components/schemas/A/$defs/Node" points inside a schema to a schema that refers to itself; inspex cannot name it, so it is typed as unknown (move it to components.schemas to give it a type) (at #/components/schemas/A/$defs/Node/properties/next/$ref)',
	);
	expect(text).toContain('next?: components["schemas"]["Node"];');
});
