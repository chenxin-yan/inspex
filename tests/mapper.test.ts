/**
 * Runs the TypeScript 7.1 compiler with `--runExternalCode` on the projects in tests/fixtures/openapi, with inspex
 * (dist/server.js) as their content mapper.
 *
 * @module-tag windows
 * @module-tag macos
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { type Compiler, fixturesDir, linkInspex, tsc, tscTimeout } from "./helpers.ts";

const run = (fixture: string, args: string[], status: number, compiler?: Compiler) =>
	tsc(join(fixturesDir, fixture), args, status, compiler);

beforeAll(() => {
	linkInspex();
	// Cached output from an older build would hide a change in the generator: the key covers dist/server.js,
	// but start clean anyway so every run here generates.
	for (const fixture of ["basic", "openapi-fetch", "versions", "register", "problems"]) {
		rmSync(join(fixturesDir, fixture, "node_modules"), { recursive: true, force: true });
	}
});

describe("a spec imported with import type", () => {
	it(
		"type-checks, and a wrong field is an error at its place (JSONC with comments, a recursive schema)",
		() => {
			const lines = run("basic", ["-p", ".", "--runExternalCode"], 2);
			expect(lines).toEqual([
				"src/app.ts(11,44): error TS2353: Object literal may only specify known properties, and 'nmae' does not exist in type '{ id: string; name: string; settings?: $schema_JsonValue | undefined; }'.",
				"src/app.ts(12,64): error TS2322: Type '() => number' is not assignable to type '$schema_JsonValue | undefined'.",
			]);
		},
		tscTimeout,
	);

	it(
		"works for OpenAPI 3.0 and 3.1, each spec its own module",
		() => {
			const lines = run("versions", ["-p", ".", "--runExternalCode"], 2);
			expect(lines).toEqual([
				"src/app.ts(8,55): error TS2322: Type 'string' is not assignable to type 'number'.",
				`src/app.ts(9,62): error TS2322: Type '"second"' is not assignable to type '"first"'.`,
			]);
		},
		tscTimeout,
	);
});

describe("openapi-fetch", () => {
	it(
		"types createClient<paths>() calls, and a wrong path is an error",
		() => {
			const lines = run("openapi-fetch", ["-p", ".", "--runExternalCode"], 2);
			expect(lines).toEqual([
				`src/app.ts(12,18): error TS2345: Argument of type '"/userz/{id}"' is not assignable to parameter of type '"/users/{id}"'.`,
				"src/app.ts(13,45): error TS2741: Property 'id' is missing in type '{}' but required in type '{ id: string; }'.",
				"src/app.ts(15,31): error TS2322: Type '{ name: string; password: string; }' is not assignable to type '{ readonly id: string; name: string; password: string; } & {}'.",
				"  Property 'id' is missing in type '{ name: string; password: string; }' but required in type '{ readonly id: string; name: string; password: string; }'.",
			]);
		},
		tscTimeout,
	);

	it(
		"leaves readOnly properties out of request bodies and writeOnly ones out of responses with readWriteMarkers",
		() => {
			const lines = run("openapi-fetch", ["-p", "tsconfig.markers.json", "--runExternalCode"], 2);
			expect(lines).toEqual([
				"src/markers.ts(15,39): error TS2322: Type 'string' is not assignable to type 'undefined'.",
				"src/markers.ts(16,29): error TS2339: Property 'password' does not exist on type '{ id: string; name: string; }'.",
			]);
		},
		tscTimeout,
	);
});

describe("the register option", () => {
	it(
		"registers each spec under its name in the consumer's interface",
		() => {
			const lines = run("register", ["-p", ".", "--runExternalCode"], 2);
			expect(lines).toEqual([
				`src/app.ts(8,22): error TS2345: Argument of type '"getInvoice"' is not assignable to parameter of type '"getUser"'.`,
				`src/app.ts(9,13): error TS2345: Argument of type '"orders"' is not assignable to parameter of type 'keyof Specs'.`,
			]);
		},
		tscTimeout,
	);

	it(
		"reports two files with the same name, naming both",
		() => {
			const lines = run("register", ["-p", "tsconfig.clash.json", "--runExternalCode"], 2);
			const clash = lines.filter((line) => line.includes("inspex7"));
			expect(clash).toHaveLength(1);
			expect(clash[0]).toMatch(
				/^(src|other)\/users\.openapi\.jsonc\(1,1\): error inspex7: Two specs register the name "users" in interface Specs of "fake-client": (src\/users\.openapi\.jsonc and other\/users\.openapi\.jsonc|other\/users\.openapi\.jsonc and src\/users\.openapi\.jsonc)\. Rename one of the files\.$/,
			);
		},
		tscTimeout,
	);

	it(
		"reports malformed options at their place in tsconfig.json",
		() => {
			const lines = run("register", ["-p", "tsconfig.malformed.json", "--runExternalCode"], 2);
			expect(lines).toEqual([
				`tsconfig.malformed.json(8,29): error inspex9: 'register.interface' must be an interface name (an identifier). 'register' must be { "module": "<package>", "interface": "<InterfaceName>" }.`,
				"tsconfig.malformed.json(8,78): error inspex9: 'readWriteMarkers' must be true or false.",
				"tsconfig.malformed.json(8,95): error inspex9: Unknown inspex option 'colour'. Known options: register, readWriteMarkers.",
			]);
		},
		tscTimeout,
	);
});

describe("problems in specs", () => {
	it(
		"are reported at their place in the spec, next to the program's other errors, and the rest stays typed",
		() => {
			const lines = run("problems", ["-p", ".", "--runExternalCode"], 2);
			expect(lines).toEqual([
				// An unrelated type error still shows: a plain mapper diagnostic would hide it.
				"src/app.ts(10,14): error TS2322: Type 'string' is not assignable to type 'number'.",
				"src/app.ts(11,14): error TS2741: Property 'id' is missing in type '{}' but required in type '{ id: string; bad?: unknown; }'.",
				// No operationIds: `operations` is empty, not a type whose members are `never`.
				"src/app.ts(12,33): error TS2339: Property 'anything' does not exist on type 'operations'.",
				// An unresolvable $ref is `unknown`, not `any`.
				"src/app.ts(14,14): error TS2322: Type 'unknown' is not assignable to type 'string'.",
				`src/broken.openapi.jsonc(6,35): error inspex3: Duplicate operationId "same", first used at #/paths/~1a/get/operationId; this operation is typed inline in paths and left out of operations (at #/paths/~1b/get/operationId)`,
				`src/broken.openapi.jsonc(11,91): error inspex4: Cannot resolve $ref "#/components/schemas/Missing"; typed as unknown (at #/paths/~1c/get/responses/200/content/application~1json/schema/$ref)`,
				`src/broken.openapi.jsonc(12,91): error inspex5: External $ref "./other.json#/Thing" is not supported (inspex reads one file); typed as unknown (at #/paths/~1c/get/responses/201/content/application~1json/schema/$ref)`,
				// Two unresolved parameters, each reported, and a path item that is not an object.
				`src/broken.openapi.jsonc(18,30): error inspex4: Cannot resolve $ref "#/components/parameters/One"; typed as unknown (at #/paths/~1d/get/parameters/0/$ref)`,
				`src/broken.openapi.jsonc(18,73): error inspex4: Cannot resolve $ref "#/components/parameters/Two"; typed as unknown (at #/paths/~1d/get/parameters/1/$ref)`,
				"src/broken.openapi.jsonc(22,11): error inspex6: Expected a path item object; left out (at #/paths/~1bad)",
				`src/broken.openapi.jsonc(26,113): error inspex4: Cannot resolve $ref "#/components/examples/X"; typed as unknown (at #/components/schemas/Good/properties/bad/$ref)`,
				"src/invalid.openapi.jsonc(3,31): error inspex1: Invalid JSONC: Expected ',' or '}'.",
				"src/notes.openapi.yaml(1,1): error inspex2: inspex reads files named <name>.openapi.jsonc; register only that extension for inspex.",
				"src/swagger.openapi.jsonc(1,14): error inspex2: Swagger 2.0 is not supported: convert the document to OpenAPI 3.0 or 3.1.",
			]);
		},
		tscTimeout,
	);
});

describe("where the mapper does not run, the import does not resolve", () => {
	const unresolved =
		"src/app.ts(1,52): error TS2307: Cannot find module './acme.openapi.jsonc' or its corresponding type declarations.";

	it(
		"TypeScript 7.1 without --runExternalCode",
		() => {
			expect(run("basic", ["-p", "."], 2)).toEqual([
				unresolved,
				"tsconfig.json(4,2): error TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.",
			]);
		},
		tscTimeout,
	);

	it(
		"TypeScript 7.0",
		() => {
			expect(run("basic", ["-p", "."], 1, "typescript-7.0")).toEqual([unresolved]);
			expect(run("basic", ["-p", ".", "--runExternalCode"], 1, "typescript-7.0")).toEqual([
				"error TS5023: Unknown compiler option '--runExternalCode'.",
			]);
		},
		tscTimeout * 2,
	);
});
