// JSON-RPC framing over stdio with LSP-style `Content-Length` headers.

const separator = "\r\n\r\n";

/**
 * Returns a chunk handler that calls `onMessage` once per complete message body. Chunks are joined once
 * per message: joining on every chunk is quadratic, and a large spec arrives in thousands of chunks.
 */
export function createMessageReader(onMessage: (body: string) => void): (chunk: Buffer) => void {
	let chunks: Buffer[] = [];
	let size = 0;
	let bodyLength = -1;
	const join = (): Buffer => {
		const buffer = chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, size);
		chunks = [buffer];
		return buffer;
	};
	const keep = (buffer: Buffer): void => {
		chunks = buffer.length ? [buffer] : [];
		size = buffer.length;
	};
	return (chunk) => {
		chunks.push(chunk);
		size += chunk.length;
		for (;;) {
			if (bodyLength < 0) {
				const buffer = join();
				const headerEnd = buffer.indexOf(separator);
				if (headerEnd < 0) return;
				const header = buffer.toString("ascii", 0, headerEnd);
				const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
				if (!match) throw new Error(`Missing Content-Length header: ${header}`);
				bodyLength = Number(match[1]);
				keep(buffer.subarray(headerEnd + separator.length));
			}
			if (size < bodyLength) return;
			const buffer = join();
			const body = buffer.toString("utf8", 0, bodyLength);
			keep(buffer.subarray(bodyLength));
			bodyLength = -1;
			onMessage(body);
		}
	};
}

export function encodeMessage(message: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${separator}`, "ascii"), body]);
}
