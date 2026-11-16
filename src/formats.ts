// Spec formats, chosen by the file name's suffix. Each one turns file content into declarations.

import { locateJsonPointers, parseJsonc, pointerKey } from "./jsonc.ts";
import { type GenerateOptions, generateOpenApiTypes, ProblemCode } from "./openapi.ts";

/** A problem located in the spec file. Offsets are UTF-16 indices into its content. */
export interface SpecProblem {
	start: number;
	length: number;
	message: string;
	code: ProblemCode;
}

export interface MappedSpec {
	/** Declarations; undefined when the file cannot be typed at all. */
	text: string | undefined;
	problems: SpecProblem[];
}

interface Format {
	suffix: string;
	map(content: string, options: GenerateOptions): MappedSpec;
}

const formats: readonly Format[] = [{ suffix: ".openapi.jsonc", map: mapOpenApiJsonc }];

/** The format of a file and the spec's name (the file name before the format suffix). */
export function formatOf(fileName: string): { format: Format; name: string } | undefined {
	const base = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
	const lower = base.toLowerCase();
	const format = formats.find((f) => lower.endsWith(f.suffix));
	return format && { format, name: base.slice(0, -format.suffix.length) };
}

function mapOpenApiJsonc(content: string, options: GenerateOptions): MappedSpec {
	const parsed = parseJsonc(content);
	if (!parsed.ok) {
		const { message, start, length } = parsed.error;
		return {
			text: undefined,
			problems: [
				{ start, length, code: ProblemCode.InvalidSyntax, message: `Invalid JSONC: ${message}` },
			],
		};
	}
	let result;
	try {
		result = generateOpenApiTypes(parsed.value, options);
	} catch (error) {
		const message = `inspex failed to type this spec: ${error instanceof Error ? error.message : String(error)}`;
		return {
			text: undefined,
			problems: [{ start: 0, length: 0, code: ProblemCode.InternalError, message }],
		};
	}
	const ranges = locateJsonPointers(
		content,
		result.problems.map((p) => p.pointer),
	);
	const problems = result.problems.map(({ pointer, message, code }) => {
		const range = ranges.get(pointerKey(pointer)) ?? { start: 0, length: 0 };
		// Underline an object or array by its opening bracket, not its whole extent.
		const bracket = /[[{]/.test(content.charAt(range.start));
		return { start: range.start, length: bracket ? 1 : range.length, message, code };
	});
	return { text: result.text, problems };
}
