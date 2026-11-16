/**
 * Compares inspex's declarations with openapi-typescript's (the test oracle) for every spec in
 * tests/fixtures/differential, with and without `readWriteMarkers`: the 7.1 compiler must find `paths`,
 * `components` and `operations` mutually assignable, member by member, with the same key types.
 *
 * inspex differs from upstream only where upstream's output is wrong or does not compile. Each such spec is
 * a named entry in `differences`: it states what upstream emits (checked here, and compiled separately to
 * prove it fails where it says so) and checks what inspex emits instead.
 *
 * openapi-typescript runs with `emptyObjectsUnknown: true`: inspex types `{ type: "object" }` as
 * `Record<string, unknown>` (upstream's default, `Record<string, never>`, makes every read `never`).
 *
 * Guard: inspex's declarations for every spec here and every other fixture spec are compiled without
 * `// @ts-nocheck` (which the mapper adds in production), and any error in them fails the test.
 *
 * Set INSPEX_DIFFERENTIAL_SPECS to a list of extra `.openapi.jsonc` files (separated by the platform's path
 * delimiter) to compare large specs that are not committed; errors in upstream's output for those are logged,
 * not failed.
 *
 * @module-tag windows
 * @module-tag macos
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, relative } from "node:path";

import openapiTS, { astToString } from "openapi-typescript";
import { afterAll, expect, it } from "vite-plus/test";

import { parseJsonc } from "../src/jsonc.ts";
import { formatPointer, generateOpenApiTypes, ProblemCode } from "../src/openapi.ts";
import { fixturesDir, tsc, tscTimeout } from "./helpers.ts";

const specsDir = join(fixturesDir, "differential");
const fixtureSpecs = readdirSync(specsDir)
	.filter((f) => f.endsWith(".openapi.jsonc"))
	.map((f) => join(specsDir, f));
const extraSpecs = process.env.INSPEX_DIFFERENTIAL_SPECS?.split(delimiter).filter(Boolean) ?? [];
const modes = [
	{ suffix: "default", readWriteMarkers: false },
	{ suffix: "markers", readWriteMarkers: true },
];

interface Difference {
	/** Why inspex differs from upstream. */
	why: string;
	/** What upstream does: assertions on its text (comments removed, whitespace collapsed) or its error. */
	upstream: (result: { text?: string; error?: string }) => void;
	/** Whether upstream's text compiles (checked); irrelevant when it throws. */
	upstreamCompiles?: boolean;
	/** TypeScript statements on inspex's types: `ours` is the module, `Same<A, B>` is mutual assignability. */
	ours: string;
	/** inspex's problems, as `[JSON pointer, code]`. */
	problems?: [string, ProblemCode][];
	/** Exports that are still equal to upstream's. */
	same?: ("paths" | "components" | "operations")[];
}

const { RefCycle, UnresolvableRef, UnsupportedRef } = ProblemCode;

const differences: Record<string, Difference> = {
	"component-aliases": {
		why: "upstream types a component that is only a $ref by the alias object itself: a parameter becomes `string`, a header `unknown`, a response, request body or path item loses its content",
		upstream: ({ text }) => {
			expect(text).toContain("parameters: { P: number; Alias: string; };");
			expect(text).toContain("headers: { H: number; Alias: unknown; };");
			expect(text).toContain('Alias: { content: { "*/*"?: never; }; };');
		},
		upstreamCompiles: true,
		ours: `
export const parameter: Same<ours.components["parameters"]["Alias"], number> = true;
export const response: Same<ours.components["responses"]["Alias"]["content"], { "text/plain": string }> = true;
export const header: Same<ours.components["headers"]["Alias"], number> = true;
export const body: Same<ours.components["requestBodies"]["Alias"], ours.components["requestBodies"]["B"]> = true;
export const pathItem: Same<ours.components["pathItems"]["Alias"]["get"], ours.operations["getP"]> = true;
export const query: Same<ours.operations["getQ"]["parameters"]["query"], { q: number }> = true;
export const responseHeader: Same<ours.components["responses"]["R"]["headers"]["X-Count"], number> = true;`,
	},
	"component-aliases-missing": {
		why: "upstream rejects the whole document; inspex types each broken alias `unknown` and reports it",
		upstream: ({ error }) => expect(error).toMatch(/Can't resolve \$ref/),
		ours: `
export const parameter: Same<ours.components["parameters"]["Alias"], unknown> = true;
export const response: Same<ours.components["responses"]["Alias"], unknown> = true;
export const header: Same<ours.components["headers"]["Alias"], unknown> = true;
export const body: Same<ours.components["requestBodies"]["Alias"], unknown> = true;
export const pathItem: Same<ours.components["pathItems"]["Alias"], unknown> = true;
export const wrongKind: Same<ours.components["schemas"]["WrongKind"], unknown> = true;`,
		problems: [
			["#/components/parameters/Alias/$ref", UnresolvableRef],
			["#/components/responses/Alias/$ref", UnresolvableRef],
			["#/components/headers/Alias/$ref", UnresolvableRef],
			["#/components/requestBodies/Alias/$ref", UnresolvableRef],
			["#/components/pathItems/Alias/$ref", UnresolvableRef],
			["#/components/schemas/WrongKind/$ref", UnsupportedRef],
		],
	},
	"ref-into-schema": {
		why: "upstream indexes the component type along the pointer, which does not compile through an optional property, `items` or a non-schema; inspex inlines the schema the pointer reaches",
		upstream: ({ text }) => {
			expect(text).toContain('Id: components["schemas"]["A"]["nested"]["id"];');
			expect(text).toContain('Item: components["schemas"]["A"]["list"]["items"];');
		},
		upstreamCompiles: false,
		ours: `
export const id: Same<ours.components["schemas"]["Id"], string> = true;
export const item: Same<ours.components["schemas"]["Item"], number> = true;
export const notASchema: Same<ours.components["schemas"]["NotASchema"], unknown> = true;`,
		problems: [["#/components/schemas/NotASchema/$ref", UnsupportedRef]],
	},
	"ref-cycles": {
		why: "upstream rejects the document; a $ref cycle with no object or array in between has no type, so inspex types its members `unknown` and reports them",
		upstream: ({ error }) => expect(error).toMatch(/circular/),
		ours: `
export const a: Same<ours.components["schemas"]["A"], unknown> = true;
export const b: Same<ours.components["schemas"]["B"], unknown> = true;
export const c: Same<ours.components["schemas"]["C"], unknown> = true;
export const json: ours.components["schemas"]["Json"] = [["x", []], "y"];
// @ts-expect-error a number is not a Json
export const notJson: ours.components["schemas"]["Json"] = [1];
export const usesA: Same<ours.components["schemas"]["UsesA"]["a"], unknown> = true;
export const selfDeep: Same<ours.components["schemas"]["SelfDeep"], { child?: unknown }> = true;
export const p1: Same<ours.components["parameters"]["P1"], unknown> = true;
export const p2: Same<ours.components["parameters"]["P2"], unknown> = true;`,
		problems: [
			["#/components/schemas/A", RefCycle],
			["#/components/schemas/B", RefCycle],
			["#/components/schemas/C", RefCycle],
			["#/components/schemas/SelfDeep/properties/child/$ref", RefCycle],
			["#/components/parameters/P1", RefCycle],
			["#/components/parameters/P2", RefCycle],
		],
	},
	"operation-id-collision": {
		why: 'upstream replaces "#" with "/" in operationIds, so "a#b" and "a/b" become one key declared twice with different types; inspex keeps operationIds as they are',
		upstream: ({ text }) => expect(text?.split('"a/b": {').length).toBe(3),
		upstreamCompiles: false,
		ours: `
export const hash: Same<ours.operations["a#b"]["responses"][200]["content"]["text/plain"], string> = true;
export const slash: Same<ours.operations["a/b"]["responses"][200]["content"]["text/plain"], number> = true;
export const path: Same<ours.paths["/a"]["get"], ours.operations["a#b"]> = true;`,
	},
	"encoded-pointer": {
		why: 'upstream unescapes "~1" before percent-decoding (RFC 6901 §6 says the reverse), cannot resolve "A%7E1B" and rejects the document',
		upstream: ({ error }) => expect(error).toMatch(/Can't resolve \$ref/),
		ours: `
export const escaped: Same<ours.components["schemas"]["Escaped"], string> = true;
export const percentEncoded: Same<ours.components["schemas"]["PercentEncoded"], string> = true;`,
	},
	"proto-discriminator": {
		why: 'upstream assigns the discriminator property with `properties[name] = …`, which for "__proto__" sets the prototype, and the property is lost',
		upstream: ({ text }) => expect(text).toContain("A: { id?: string; };"),
		upstreamCompiles: true,
		ours: 'export const kind: Same<ours.components["schemas"]["A"]["__proto__"], "A"> = true;',
		same: ["paths"],
	},
	"prototype-required": {
		why: 'upstream looks `required` names up through Object.prototype and emits `WithRequired<Base, "constructor">`, which does not compile',
		upstream: ({ text }) =>
			expect(text).toContain('Ext: WithRequired<components["schemas"]["Base"], "constructor">;'),
		upstreamCompiles: false,
		ours: 'export const ext: Same<ours.components["schemas"]["Ext"], ours.components["schemas"]["Base"]> = true;',
	},
};

/**
 * Named difference wherever a spec has no operationIds (as in no-operation-ids.openapi.jsonc): upstream's
 * `operations = Record<string, never>` makes `operations[anything]` compile as `never`; inspex's
 * `operations` is an empty interface.
 */
const noOperations = {
	upstream: "export type operations = Record<string, never>;",
	ours: "\nexport const operations: [keyof ours.operations] extends [never] ? true : false = true;",
};

const byText = (a: string, b: string): number => a.localeCompare(b);

const work = mkdtempSync(join(tmpdir(), "inspex-differential-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function parse(file: string): unknown {
	const parsed = parseJsonc(readFileSync(file, "utf8"));
	if (!parsed.ok) throw new Error(`${file}: ${parsed.error.message}`);
	return parsed.value;
}

const normalize = (text: string): string =>
	text
		.replaceAll(/\/\*\*[\s\S]*?\*\//g, "")
		.replaceAll(/\s+/g, " ")
		.trim();

/** Every other spec in tests/fixtures, for the compile guard. */
function guardSpecs(): string[] {
	const out: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules" && file !== specsDir) visit(file);
			} else if (entry.name.endsWith(".openapi.jsonc")) {
				out.push(file);
			}
		}
	};
	visit(fixturesDir);
	return out;
}

const header = (stem: string): string => `import type * as ours from "./${stem}.ours.ts";
import type * as theirs from "./${stem}.theirs.ts";
import type { Diff, KeysSame, Same } from "./diff.ts";
`;
// Key types of `operations` are compared through `paths`, which refers to them: comparing them again is too
// deep for the compiler on a large spec.
const compare = (name: string): string => `
export const ${name}: Diff<ours.${name}, theirs.${name}> = true;${
	name === "operations"
		? ""
		: `\nexport const ${name}Keys: KeysSame<ours.${name}, theirs.${name}> = true;`
}`;

it(
	"emits the same types as openapi-typescript, except for the named differences",
	async () => {
		const files: string[] = [];
		const upstreamFiles: string[] = [];
		const upstreamExpectedToFail = new Set<string>();
		const extraTheirs = new Set<string>();
		for (const spec of [...fixtureSpecs, ...extraSpecs]) {
			const name = basename(spec, ".openapi.jsonc");
			const difference = fixtureSpecs.includes(spec) ? differences[name] : undefined;
			for (const mode of modes) {
				const stem = `${name}.${mode.suffix}`;
				const ours = generateOpenApiTypes(parse(spec), { readWriteMarkers: mode.readWriteMarkers });
				const problems = ours.problems.map((p) => `${formatPointer(p.pointer)} ${p.code}`);
				const expected = (difference?.problems ?? []).map(
					([pointer, code]) => `${pointer} ${code}`,
				);
				expect.soft(problems.toSorted(byText), stem).toEqual(expected.toSorted(byText));
				writeFileSync(join(work, `${stem}.ours.ts`), ours.text ?? "");
				let text: string | undefined;
				let error: string | undefined;
				try {
					text = astToString(
						await openapiTS(parse(spec) as never, {
							silent: true,
							emptyObjectsUnknown: true,
							readWriteMarkers: mode.readWriteMarkers,
						}),
					);
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				}
				if (!difference) {
					expect(error, stem).toBeUndefined();
					writeFileSync(join(work, `${stem}.theirs.ts`), text ?? "");
					writeFileSync(
						join(work, `${stem}.check.ts`),
						header(stem) +
							compare("paths") +
							compare("components") +
							(text?.includes(noOperations.upstream) ? noOperations.ours : compare("operations")),
					);
					files.push(`${stem}.check.ts`);
					if (!fixtureSpecs.includes(spec)) extraTheirs.add(`${stem}.theirs.ts`);
					continue;
				}
				difference.upstream({ text: text === undefined ? undefined : normalize(text), error });
				if (text !== undefined) {
					mkdirSync(join(work, "upstream"), { recursive: true });
					writeFileSync(join(work, "upstream", `${stem}.ts`), text);
					upstreamFiles.push(`${stem}.ts`);
					if (difference.upstreamCompiles === false) upstreamExpectedToFail.add(`${stem}.ts`);
				}
				const same = difference.same ?? [];
				if (same.length) writeFileSync(join(work, `${stem}.theirs.ts`), text ?? "");
				writeFileSync(
					join(work, `${stem}.check.ts`),
					(same.length
						? header(stem)
						: header(stem).replace(/^import type \* as theirs.*\n/m, "")) +
						same.map(compare).join("") +
						difference.ours,
				);
				files.push(`${stem}.check.ts`);
			}
		}
		mkdirSync(join(work, "guard"));
		for (const spec of guardSpecs()) {
			const parsed = parseJsonc(readFileSync(spec, "utf8"));
			if (!parsed.ok) continue;
			const text = generateOpenApiTypes(parsed.value).text;
			if (text === undefined) continue;
			const file = `guard/${relative(fixturesDir, spec).replaceAll(/[\\/]/g, "_")}.ts`;
			writeFileSync(join(work, file), text);
			files.push(file);
		}
		writeFileSync(
			join(work, "diff.ts"),
			`export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** \`true\` when A and B are mutually assignable, otherwise the keys whose types differ. */
export type Diff<A, B> = [Same<A, B>] extends [true]
	? true
	: { [K in keyof A | keyof B]: K extends keyof A ? (K extends keyof B ? (Same<A[K], B[K]> extends true ? never : K) : K) : K }[keyof A | keyof B];
/**
 * Mutual assignability does not see key types: \`{ "200": X }\` and \`{ 200: X }\` are assignable both ways,
 * but tools filter keys by type (openapi-fetch looks for numeric success statuses). So keys are compared too.
 */
export type KeysSame<A, B, Depth extends unknown[] = []> = Depth["length"] extends 12
	? true
	: [A] extends [object]
		? [B] extends [object]
			? Same<keyof A, keyof B> extends true
				? false extends { [K in keyof A & keyof B]-?: KeysSame<A[K], B[K], [...Depth, 0]> }[keyof A & keyof B]
					? false
					: true
				: false
			: true
		: true;
`,
		);
		const config = (included: string[]) =>
			JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					module: "preserve",
					moduleResolution: "bundler",
					allowImportingTsExtensions: true,
					types: [],
				},
				files: included,
			});
		writeFileSync(join(work, "tsconfig.json"), config(["diff.ts", ...files]));
		const result = tsc(work, ["-p", "."]);
		// Upstream defects in large specs that are not committed are reported, not failed.
		const upstreamDefects = result.lines.filter((l) => extraTheirs.has(l.slice(0, l.indexOf("("))));
		if (upstreamDefects.length)
			console.log(`upstream's own errors:\n${upstreamDefects.join("\n")}`);
		expect.soft(result.lines.filter((l) => !upstreamDefects.includes(l))).toEqual([]);

		// Upstream's text for the named differences fails to compile exactly where the table says so.
		writeFileSync(join(work, "upstream", "tsconfig.json"), config(upstreamFiles));
		const upstream = tsc(join(work, "upstream"), ["-p", "."]);
		const failing = new Set(upstream.lines.map((l) => l.slice(0, l.indexOf("("))).filter(Boolean));
		expect([...failing].toSorted(byText)).toEqual([...upstreamExpectedToFail].toSorted(byText));
	},
	tscTimeout * 3,
);
