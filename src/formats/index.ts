// Spec formats, chosen by the file name's suffix. Each one turns file content into declarations.

import type { MappedSpec } from "../problems.ts";
import type { GenerateOptions } from "./openapi/context.ts";
import { mapOpenApiJsonc } from "./openapi/index.ts";

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
