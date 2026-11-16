// What a format reports about a spec file, shared by the formats and the mapper.

/** Diagnostic codes, shown as `inspex<code>`. */
export const ProblemCode = {
	InvalidSyntax: 1,
	UnsupportedDocument: 2,
	DuplicateOperationId: 3,
	UnresolvableRef: 4,
	UnsupportedRef: 5,
	InvalidValue: 6,
	DuplicateRegisteredName: 7,
	InternalError: 8,
	InvalidOption: 9,
	RefCycle: 10,
} as const;
export type ProblemCode = (typeof ProblemCode)[keyof typeof ProblemCode];

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
