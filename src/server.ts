// The content mapper process (package.json: typescript.contentMapper.exec). TypeScript writes JSON-RPC
// requests to stdin and reads the replies from stdout, so nothing else may be written to stdout.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Mapper } from "./mapper.ts";
import type {
	CloseProjectParams,
	InitializeParams,
	OpenProjectParams,
	TransformParams,
} from "./protocol.ts";
import { createMessageReader, encodeMessage } from "./rpc.ts";

const mapper = new Mapper(
	createHash("sha256")
		.update(readFileSync(fileURLToPath(import.meta.url)))
		.digest("hex"),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

/** Thrown for a request TypeScript should not have sent; answered with its JSON-RPC error code. */
class RpcError extends Error {
	readonly code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

const validParams: Record<string, (params: Record<string, unknown>) => boolean> = {
	initialize: (p) => Array.isArray(p.positionEncodings),
	openProject: (p) =>
		isString(p.configFileName) &&
		isString(p.projectHandle) &&
		(p.options === undefined || isRecord(p.options)),
	transform: (p) => isString(p.fileName) && isString(p.content) && isString(p.projectHandle),
	closeProject: (p) => isString(p.projectHandle),
};

function dispatch(method: string, params: unknown): unknown {
	const valid = validParams[method];
	if (!Object.hasOwn(validParams, method) || !valid) {
		throw new RpcError(-32_601, `Method not found: ${method}`);
	}
	if (!isRecord(params) || !valid(params)) {
		throw new RpcError(-32_602, `Invalid params for ${method}`);
	}
	switch (method) {
		case "initialize":
			return mapper.initialize(params as unknown as InitializeParams);
		case "openProject":
			return mapper.openProject(params as unknown as OpenProjectParams);
		case "transform":
			return mapper.transform(params as unknown as TransformParams);
		default:
			mapper.closeProject((params as unknown as CloseProjectParams).projectHandle);
			return null;
	}
}

const reply = (message: Record<string, unknown>): boolean =>
	process.stdout.write(encodeMessage({ jsonrpc: "2.0", ...message }));

function handle(body: string): void {
	let request: unknown;
	try {
		request = JSON.parse(body);
	} catch {
		reply({ id: null, error: { code: -32_700, message: "Parse error" } });
		return;
	}
	const id =
		isRecord(request) && (isString(request.id) || typeof request.id === "number")
			? request.id
			: null;
	if (!isRecord(request) || id === null || !isString(request.method)) {
		reply({ id, error: { code: -32_600, message: "Invalid request" } });
		return;
	}
	try {
		reply({ id, result: dispatch(request.method, request.params) });
	} catch (error) {
		reply({
			id,
			error: {
				code: error instanceof RpcError ? error.code : -32_603,
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

const read = createMessageReader(handle);
process.stdin.on("data", (chunk: Buffer) => {
	try {
		read(chunk);
	} catch (error) {
		// The stream cannot be resynchronized after a framing error. Stop reading, and let the pending
		// replies flush before the process exits with an error (process.exit could cut them off).
		process.stderr.write(
			`inspex: malformed message from TypeScript: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
		process.stdin.destroy();
	}
});
