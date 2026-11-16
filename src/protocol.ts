// The parts of TypeScript's content mapper protocol (microsoft/typescript-go#4712, amended by
// microsoft/TypeScript#63936) that inspex uses. TypeScript sends JSON-RPC 2.0 requests over stdio.

export type PositionEncoding = "utf-8" | "utf-16";

export interface InitializeParams {
	positionEncodings: PositionEncoding[];
	locale?: string;
}

export interface InitializeResult {
	positionEncoding: PositionEncoding;
	diagnosticSource: string;
}

export interface OpenProjectParams {
	/** Absolute tsconfig path, or "" for a project without a config file. */
	configFileName: string;
	projectHandle: string;
	options?: Record<string, unknown>;
	compilerOptions: Record<string, unknown>;
}

export interface OptionDiagnostic {
	/** Property names and array indexes relative to the entry's `options` object. */
	path: (string | number)[];
	messageText: string;
	code: number;
}

export interface OpenProjectResult {
	optionDiagnostics?: OptionDiagnostic[];
}

export interface TransformParams {
	fileName: string;
	content: string;
	projectHandle: string;
}

export interface CloseProjectParams {
	projectHandle: string;
}

export const DiagnosticDirectivePolicy = { Ignore: 0, Expect: 1 } as const;

/** [originalStart, originalLength, virtualStart, virtualEnd, policy, unusedExpectDirectiveIndex] */
export type MappedDiagnosticDirective = [number, number, number, number, number, number];

export interface DiagnosticDirectives {
	unusedExpectDirectiveDiagnostics: { code: number; messageText: string }[];
	directives: MappedDiagnosticDirective[];
}

export interface MappedOutput {
	text: string;
	extension: ".ts";
	diagnosticDirectives?: DiagnosticDirectives;
}

export interface TransformResult extends MappedOutput {
	supplemental?: MappedOutput[];
}
