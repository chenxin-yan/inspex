/**
 * Compares inspex's declarations with openapi-typescript's (the test oracle) for every spec in
 * tests/fixtures/differential: the 7.1 compiler must find `paths`, `components` and `operations` mutually
 * assignable, member by member, with and without `readWriteMarkers`. inspex's text is checked without
 * `// @ts-nocheck`, so a broken reference fails here instead of becoming `any`.
 *
 * openapi-typescript runs with `emptyObjectsUnknown: true`: inspex deliberately types `{ type: "object" }`
 * as `Record<string, unknown>` (upstream's default, `Record<string, never>`, makes every read `never`).
 * Other deliberate differences are stated per spec in `operationsCheck`.
 *
 * Set INSPEX_DIFFERENTIAL_SPECS to a list of extra `.openapi.jsonc` files (separated by the platform's path
 * delimiter) to compare large specs that are not committed.
 *
 * @module-tag windows
 * @module-tag macos
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";

import openapiTS, { astToString } from "openapi-typescript";
import { afterAll, expect, it } from "vite-plus/test";

import { parseJsonc } from "../src/jsonc.ts";
import { generateOpenApiTypes } from "../src/openapi.ts";
import { fixturesDir, tsc, tscTimeout } from "./helpers.ts";

const specsDir = join(fixturesDir, "differential");
const specs = [
	...readdirSync(specsDir)
		.filter((f) => f.endsWith(".openapi.jsonc"))
		.map((f) => join(specsDir, f)),
	...(process.env.INSPEX_DIFFERENTIAL_SPECS?.split(delimiter).filter(Boolean) ?? []),
];
const modes = [
	{ suffix: "default", readWriteMarkers: false },
	{ suffix: "markers", readWriteMarkers: true },
];

/** Deliberate differences in `operations`, by spec name. */
const operationsCheck: Record<string, (ours: string, theirs: string) => string> = {
	// Upstream's `Record<string, never>` makes `operations["anything"]` compile as `never`.
	"no-operation-ids": (ours, theirs) => `
export const oursEmpty: [keyof ${ours}.operations] extends [never] ? true : false = true;
export const theirsRecord: ${theirs}.operations extends Record<string, never> ? (string extends keyof ${theirs}.operations ? true : false) : false = true;`,
};

const work = mkdtempSync(join(tmpdir(), "inspex-differential-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function parse(file: string): unknown {
	const parsed = parseJsonc(readFileSync(file, "utf8"));
	if (!parsed.ok) throw new Error(`${file}: ${parsed.error.message}`);
	return parsed.value;
}

it(
	"emits the same types as openapi-typescript",
	async () => {
		const checks: string[] = [];
		for (const spec of specs) {
			const name = basename(spec, ".openapi.jsonc");
			for (const mode of modes) {
				const stem = `${name}.${mode.suffix}`;
				const ours = generateOpenApiTypes(parse(spec), { readWriteMarkers: mode.readWriteMarkers });
				expect(ours.problems, stem).toEqual([]);
				writeFileSync(join(work, `${stem}.ours.ts`), ours.text ?? "");
				const ast = await openapiTS(parse(spec) as never, {
					silent: true,
					emptyObjectsUnknown: true,
					readWriteMarkers: mode.readWriteMarkers,
				});
				writeFileSync(join(work, `${stem}.theirs.ts`), astToString(ast));
				const check =
					operationsCheck[name]?.("ours", "theirs") ??
					`
export const operations: Diff<ours.operations, theirs.operations> = true;`;
				writeFileSync(
					join(work, `${stem}.check.ts`),
					`import type * as ours from "./${stem}.ours.ts";
import type * as theirs from "./${stem}.theirs.ts";
import type { Diff, KeysSame } from "./diff.ts";
export const paths: Diff<ours.paths, theirs.paths> = true;
export const components: Diff<ours.components, theirs.components> = true;
export const schemas: Diff<ours.components["schemas"], theirs.components["schemas"]> = true;
export const pathsKeys: KeysSame<ours.paths, theirs.paths> = true;
export const componentsKeys: KeysSame<ours.components, theirs.components> = true;
${check}
`,
				);
				checks.push(`${stem}.check.ts`);
			}
		}
		writeFileSync(
			join(work, "diff.ts"),
			`type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
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
		writeFileSync(
			join(work, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					module: "preserve",
					moduleResolution: "bundler",
					allowImportingTsExtensions: true,
					types: [],
				},
				files: ["diff.ts", ...checks],
			}),
		);
		const result = tsc(work, ["-p", "."]);
		expect(result.lines).toEqual([]);
		expect(result.status).toBe(0);
	},
	tscTimeout * 2,
);
