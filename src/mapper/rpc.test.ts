import { expect, it } from "vite-plus/test";

import { createMessageReader, encodeMessage } from "./rpc.ts";

it("reads messages split across chunks and several in one chunk", () => {
	const bodies: string[] = [];
	const read = createMessageReader((body) => bodies.push(body));
	const first = encodeMessage({ id: 1, text: "héllo" });
	const second = encodeMessage({ id: 2 });
	const third = encodeMessage({ id: 3 });
	for (let i = 0; i < first.length; i += 3) read(first.subarray(i, i + 3));
	read(Buffer.concat([second, third]));
	expect(bodies.map((b) => JSON.parse(b))).toEqual([
		{ id: 1, text: "héllo" },
		{ id: 2 },
		{ id: 3 },
	]);
});

it("counts the Content-Length in bytes", () => {
	expect(encodeMessage("é").toString()).toBe('Content-Length: 4\r\n\r\n"é"');
});
