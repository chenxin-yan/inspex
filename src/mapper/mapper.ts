// Answers the content mapper protocol's requests; src/server.ts connects it to stdio.

import { existsSync } from "node:fs";
import { relative } from "node:path";

import { formatOf } from "../formats/index.ts";
import { type MappedSpec, ProblemCode, type SpecProblem } from "../problems.ts";
import { cacheDirectory, cacheKey, readCache, writeCache } from "./cache.ts";
import { type MapperOptions, parseOptions } from "./options.ts";
import {
	DiagnosticDirectivePolicy,
	type InitializeParams,
	type InitializeResult,
	type MappedOutput,
	type OpenProjectParams,
	type OpenProjectResult,
	type TransformParams,
	type TransformResult,
} from "./protocol.ts";

interface Project {
	configFileName: string;
	options: MapperOptions;
	/** Spec name -> file name, for `register`: two files may not register the same name. */
	registered: Map<string, string>;
}

export class Mapper {
	readonly #projects = new Map<string, Project>();
	readonly #codeIdentity: string;

	/** `codeIdentity` changes whenever the generator's code does; it keys the cache. */
	constructor(codeIdentity: string) {
		this.#codeIdentity = codeIdentity;
	}

	initialize({ positionEncodings }: InitializeParams): InitializeResult {
		// UTF-16, so that JavaScript string indices are positions.
		if (!positionEncodings.includes("utf-16")) {
			throw new Error("inspex needs the utf-16 position encoding.");
		}
		return { positionEncoding: "utf-16", diagnosticSource: "inspex" };
	}

	openProject({ configFileName, projectHandle, options }: OpenProjectParams): OpenProjectResult {
		const parsed = parseOptions(options);
		this.#projects.set(projectHandle, {
			configFileName,
			options: parsed.options,
			registered: new Map(),
		});
		return parsed.diagnostics.length ? { optionDiagnostics: parsed.diagnostics } : {};
	}

	closeProject(projectHandle: string): void {
		this.#projects.delete(projectHandle);
	}

	transform({ fileName, content, projectHandle }: TransformParams): TransformResult {
		const project = this.#projects.get(projectHandle) ?? {
			configFileName: "",
			options: parseOptions(undefined).options,
			registered: new Map<string, string>(),
		};
		const spec = formatOf(fileName);
		if (!spec) {
			return withProblems({ text: "export {};\n", extension: ".ts" }, "", [
				{
					start: 0,
					length: 0,
					code: ProblemCode.UnsupportedDocument,
					message:
						"inspex reads files named <name>.openapi.jsonc; register only that extension for inspex.",
				},
			]);
		}
		const mapped = this.#map(project, content, () => spec.format.map(content, project.options));
		const problems = [...mapped.problems];
		let registration = "";
		const { register } = project.options;
		if (register && mapped.text !== undefined) {
			const other = project.registered.get(spec.name);
			if (other !== undefined && other !== fileName && existsSync(other)) {
				const show = (file: string): string =>
					(project.configFileName
						? relative(project.configFileName.replace(/[^/\\]*$/, ""), file)
						: file
					).replaceAll("\\", "/");
				problems.push({
					start: 0,
					length: 0,
					code: ProblemCode.DuplicateRegisteredName,
					message: `Two specs register the name "${spec.name}" in interface ${register.interface} of "${register.module}": ${show(other)} and ${show(fileName)}. Rename one of the files.`,
				});
			} else {
				project.registered.set(spec.name, fileName);
				registration = registrationText(fileName, spec.name, register);
			}
		}
		const main: MappedOutput = {
			// The declarations are not checked: errors in them would surface in the user's build, and
			// checking a large spec's types costs more than using them.
			text: mapped.text === undefined ? "export {};\n" : `// @ts-nocheck\n${mapped.text}`,
			extension: ".ts",
		};
		return withProblems(main, registration, problems);
	}

	#map(project: Project, content: string, generate: () => MappedSpec): MappedSpec {
		const directory = cacheDirectory(project.configFileName);
		if (!directory) return generate();
		const key = cacheKey(
			this.#codeIdentity,
			JSON.stringify({ markers: project.options.readWriteMarkers }),
			content,
		);
		const cached = readCache(directory, key);
		if (cached) return cached;
		const mapped = generate();
		writeCache(directory, key, mapped);
		return mapped;
	}
}

/** The module augmentation that registers a spec's types under its name. */
export function registrationText(
	fileName: string,
	name: string,
	register: NonNullable<MapperOptions["register"]>,
): string {
	const file = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
	return `import type { paths, components, operations } from ${JSON.stringify(`./${file}`)};
declare module ${JSON.stringify(register.module)} {
interface ${register.interface} {
${JSON.stringify(name)}: { paths: paths; components: components; operations: operations };
}
}
`;
}

/**
 * Adds a supplemental output carrying the registration and the spec's problems. Each problem is an
 * `Expect` diagnostic directive over an empty range, so TypeScript reports its message, unused, at the
 * problem's place in the spec. A mapper's `diagnostics` would be simpler, but TypeScript treats them as
 * syntax errors and then hides every semantic error in the program (verified on 7.1.0-beta). The
 * supplemental output is not `@ts-nocheck`, which would also silence the directives.
 */
function withProblems(
	main: MappedOutput,
	registration: string,
	problems: SpecProblem[],
): TransformResult {
	if (!registration && !problems.length) return main;
	const supplemental: MappedOutput = { text: `${registration}export {};\n`, extension: ".ts" };
	if (problems.length) {
		supplemental.diagnosticDirectives = {
			unusedExpectDirectiveDiagnostics: problems.map(({ code, message }) => ({
				code,
				messageText: message,
			})),
			directives: problems.map(({ start, length }, i) => [
				start,
				length,
				0,
				0,
				DiagnosticDirectivePolicy.Expect,
				i,
			]),
		};
	}
	return { ...main, supplemental: [supplemental] };
}
