export const DEFAULT_CHUNK_SIZE = 9 * 1024 * 1024; // 9 MB

export async function* rechunk(
  stream: ReadableStream<Uint8Array>,
  chunkSize = DEFAULT_CHUNK_SIZE
): AsyncGenerator<Buffer> {
  const reader = stream.getReader();
  let buffer = Buffer.alloc(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) yield buffer;
        break;
      }
      buffer = Buffer.concat([buffer, Buffer.from(value)]);
      while (buffer.length >= chunkSize) {
        yield Buffer.from(buffer.subarray(0, chunkSize));
        buffer = Buffer.from(buffer.subarray(chunkSize));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
