/**
 * The mapper process (dist/server.js) against malformed protocol input. TypeScript reads its stdout as
 * protocol frames, so nothing else may ever appear there.
 *
 * @module-tag windows
 * @module-tag macos
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

import { expect, it } from "vite-plus/test";

import { repoRoot, tscTimeout } from "./helpers.ts";

const frame = (body: string): Buffer => {
	const bytes = Buffer.from(body, "utf8");
	return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, "ascii"), bytes]);
};

/** Runs the server on `input`, closes stdin, and splits stdout into frames; leftovers fail the parse. */
async function run(
	input: Buffer[],
): Promise<{ status: number | null; replies: unknown[]; stderr: string }> {
	const child = spawn(process.execPath, [join(repoRoot, "dist", "server.js")], { stdio: "pipe" });
	const stdout: Buffer[] = [];
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
	const status = new Promise<number | null>((resolve) => child.on("close", resolve));
	for (const chunk of input) child.stdin.write(chunk);
	child.stdin.end();
	const code = await status;
	let rest = Buffer.concat(stdout);
	const replies: unknown[] = [];
	while (rest.length) {
		const match = /^Content-Length: (\d+)\r\n\r\n/.exec(rest.toString("latin1", 0, 64));
		if (!match)
			throw new Error(`stdout is not only protocol frames: ${JSON.stringify(rest.toString())}`);
		const start = match[0].length;
		const length = Number(match[1]);
		replies.push(JSON.parse(rest.toString("utf8", start, start + length)));
		rest = rest.subarray(start + length);
	}
	return { status: code, replies, stderr };
}

it(
	"answers malformed requests with protocol errors and keeps serving",
	async () => {
		const result = await run([
			frame(
				'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"positionEncodings":["utf-16"]}}',
			),
			frame("null"),
			frame("[]"),
			frame('{"jsonrpc":"2.0","id":2}'),
			frame('{"jsonrpc":"2.0","id":3,"method":"transform","params":null}'),
			frame("not json"),
			frame('{"jsonrpc":"2.0","id":4,"method":"nope","params":{}}'),
			frame('{"jsonrpc":"2.0","id":5,"method":"closeProject","params":{"projectHandle":"p"}}'),
		]);
		expect(result.replies).toEqual([
			{ jsonrpc: "2.0", id: 1, result: { positionEncoding: "utf-16", diagnosticSource: "inspex" } },
			{ jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid request" } },
			{ jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid request" } },
			{ jsonrpc: "2.0", id: 2, error: { code: -32_600, message: "Invalid request" } },
			{ jsonrpc: "2.0", id: 3, error: { code: -32_602, message: "Invalid params for transform" } },
			{ jsonrpc: "2.0", id: null, error: { code: -32_700, message: "Parse error" } },
			{ jsonrpc: "2.0", id: 4, error: { code: -32_601, message: "Method not found: nope" } },
			{ jsonrpc: "2.0", id: 5, result: null },
		]);
		expect(result.status).toBe(0);
	},
	tscTimeout,
);

it(
	"exits with an error on stderr, not stdout, when a message has no Content-Length",
	async () => {
		const result = await run([
			frame('{"jsonrpc":"2.0","id":1,"method":"closeProject","params":{"projectHandle":"p"}}'),
			Buffer.from("Content-Type: x\r\n\r\n{}"),
		]);
		expect(result.replies).toEqual([{ jsonrpc: "2.0", id: 1, result: null }]);
		expect(result.stderr).toContain(
			"inspex: malformed message from TypeScript: Missing Content-Length header",
		);
		expect(result.status).toBe(1);
	},
	tscTimeout,
);
