// Turns a streaming fetch Response into an async iterator of parsed events (newline-delimited JSON).
export async function* readEvents(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();                    // the last piece may be half a line; keep it for the next chunk
    for (const line of lines) if (line) yield JSON.parse(line);
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}
