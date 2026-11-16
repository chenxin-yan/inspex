/**
 * @module-tag windows
 * @module-tag macos
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { Mapper, registrationText } from "./mapper.ts";
import { ProblemCode } from "./openapi.ts";

const spec = JSON.stringify({ openapi: "3.1.0", info: { title: "t", version: "1" }, paths: {} });
const register = { module: "@acme/client", interface: "Specs" };
const work = mkdtempSync(join(tmpdir(), "inspex-mapper-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A mapper with one project without a tsconfig, so nothing is cached. */
function open(options?: Record<string, unknown>): Mapper {
	const mapper = new Mapper("test");
	mapper.openProject({ configFileName: "", projectHandle: "p", options, compilerOptions: {} });
	return mapper;
}

it("writes the registration as a module augmentation that imports the spec itself", () => {
	expect(registrationText(join("dir", "billing.openapi.jsonc"), "billing", register)).toBe(
		`import type { paths, components, operations } from "./billing.openapi.jsonc";
declare module "@acme/client" {
interface Specs {
"billing": { paths: paths; components: components; operations: operations };
}
}
`,
	);
});

describe("transform", () => {
	it("returns checked-off declarations and nothing else for a clean spec without register", () => {
		const result = open().transform({
			fileName: "/a/acme.openapi.jsonc",
			content: spec,
			projectHandle: "p",
		});
		expect(result.text.startsWith("// @ts-nocheck\nexport type paths")).toBe(true);
		expect(result.supplemental).toBeUndefined();
	});

	it("reports problems as unused Expect directives in a supplemental output", () => {
		const content = '{ "swagger": "2.0" }';
		const result = open().transform({
			fileName: "/a/acme.openapi.jsonc",
			content,
			projectHandle: "p",
		});
		expect(result.text).toBe("export {};\n");
		expect(result.supplemental).toEqual([
			{
				text: "export {};\n",
				extension: ".ts",
				diagnosticDirectives: {
					unusedExpectDirectiveDiagnostics: [
						{
							code: ProblemCode.UnsupportedDocument,
							messageText:
								"Swagger 2.0 is not supported: convert the document to OpenAPI 3.0 or 3.1.",
						},
					],
					directives: [[content.indexOf('"2.0"'), 5, 0, 0, 1, 0]],
				},
			},
		]);
	});

	it("registers each spec; an edit, or a registered file that is gone, is no clash", () => {
		const mapper = open({ register });
		const transform = (fileName: string) =>
			mapper.transform({ fileName, content: spec, projectHandle: "p" });
		const first = join(work, "a", "users.openapi.jsonc");
		expect(transform(first).supplemental?.[0]?.text).toContain("declare module");
		expect(transform(first).supplemental?.[0]?.diagnosticDirectives).toBeUndefined();
		// `first` does not exist on disk (renamed or deleted in an editor), so `second` takes the name.
		const second = join(work, "b", "users.openapi.jsonc");
		expect(transform(second).supplemental?.[0]?.text).toContain("declare module");
		expect(transform(second).supplemental?.[0]?.diagnosticDirectives).toBeUndefined();
	});

	it("reports a clash naming both files when both exist", () => {
		const mapper = open({ register });
		const first = join(work, "one.openapi.jsonc");
		const second = join(work, "nested", "..", "x", "one.openapi.jsonc");
		writeFileSync(first, spec);
		mapper.transform({ fileName: first, content: spec, projectHandle: "p" });
		const result = mapper.transform({ fileName: second, content: spec, projectHandle: "p" });
		const [message] =
			result.supplemental?.[0]?.diagnosticDirectives?.unusedExpectDirectiveDiagnostics ?? [];
		expect(message?.code).toBe(ProblemCode.DuplicateRegisteredName);
		expect(message?.messageText).toContain(first.replaceAll("\\", "/"));
		expect(message?.messageText).toContain(second.replaceAll("\\", "/"));
		expect(result.supplemental?.[0]?.text).toBe("export {};\n");
	});

	it("regenerates over a cache entry that cannot be read back, and replaces it", () => {
		const project = join(work, "deep-entry");
		const cache = join(project, "node_modules", ".cache", "inspex");
		mkdirSync(project, { recursive: true });
		const mapper = new Mapper("test");
		mapper.openProject({
			configFileName: join(project, "tsconfig.json"),
			projectHandle: "q",
			compilerOptions: {},
		});
		const params = {
			fileName: join(project, "a.openapi.jsonc"),
			content: spec,
			projectHandle: "q",
		};
		const first = mapper.transform(params);
		const [entry] = readdirSync(cache);
		const deep = `${"[".repeat(20_000)}${"]".repeat(20_000)}`;
		// The entry's own key, a wrong checksum and a payload too deep to walk recursively.
		const { key } = JSON.parse(
			readFileSync(join(cache, entry as string), "utf8").split("\n")[0] as string,
		);
		writeFileSync(
			join(cache, entry as string),
			`{"key":${JSON.stringify(key)},"checksum":"wrong","text":null,"problems":${deep}}`,
		);
		expect(mapper.transform(params)).toEqual(first);
		expect(readFileSync(join(cache, entry as string), "utf8")).not.toContain("[[[");
	});

	it("reports a file whose name has no known format", () => {
		const result = open().transform({
			fileName: "/a/acme.openapi.yaml",
			content: "",
			projectHandle: "p",
		});
		expect(
			result.supplemental?.[0]?.diagnosticDirectives?.unusedExpectDirectiveDiagnostics[0]
				?.messageText,
		).toBe(
			"inspex reads files named <name>.openapi.jsonc; register only that extension for inspex.",
		);
	});
});
