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

function dispatch(method: string, params: unknown): unknown {
	switch (method) {
		case "initialize":
			return mapper.initialize(params as InitializeParams);
		case "openProject":
			return mapper.openProject(params as OpenProjectParams);
		case "transform":
			return mapper.transform(params as TransformParams);
		case "closeProject":
			mapper.closeProject((params as CloseProjectParams).projectHandle);
			return null;
		default:
			throw Object.assign(new Error(`Method not found: ${method}`), { code: -32_601 });
	}
}

process.stdin.on(
	"data",
	createMessageReader((body) => {
		let request: { id?: string | number; method?: string; params?: unknown };
		try {
			request = JSON.parse(body);
		} catch {
			process.stdout.write(
				encodeMessage({
					jsonrpc: "2.0",
					id: null,
					error: { code: -32_700, message: "Parse error" },
				}),
			);
			return;
		}
		const { id = null, method = "", params } = request;
		try {
			process.stdout.write(encodeMessage({ jsonrpc: "2.0", id, result: dispatch(method, params) }));
		} catch (error) {
			const code = (error as { code?: unknown }).code;
			process.stdout.write(
				encodeMessage({
					jsonrpc: "2.0",
					id,
					error: {
						code: typeof code === "number" ? code : -32_603,
						message: error instanceof Error ? error.message : String(error),
					},
				}),
			);
		}
	}),
);
