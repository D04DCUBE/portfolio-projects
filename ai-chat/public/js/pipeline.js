// The outbound message pipeline: a list of small stages, each taking the history and returning a new one.
// Order matters and each stage is testable alone, which is the point of keeping them separate.
export const MAX_HISTORY = 30;

// Images are big and only matter for the turn they were attached to. Older turns keep a text note instead.
export function stripOldAttachments(history) {
  const lastUser = history.findLastIndex((m) => m.role === "user");
  return history.map((m, i) => {
    if (!m.attachments?.length || i === lastUser) return m;
    const note = m.attachments.map((a) => `[attached ${a.kind}: ${a.name}]`).join(" ");
    const { attachments, ...rest } = m;
    return { ...rest, content: (rest.content + " " + note).trim() };
  });
}

// Keep the most recent messages, but never start on a tool result without the assistant request before it.
export function limitHistory(history, max = MAX_HISTORY) {
  if (history.length <= max) return history;
  let out = history.slice(-max);
  while (out.length && out[0].role !== "user") out = out.slice(1);
  return out;
}

export const OUTBOUND_STAGES = [stripOldAttachments, limitHistory];
export const buildRequest = (history, stages = OUTBOUND_STAGES) => stages.reduce((h, stage) => stage(h), history);

// Reading a picked file into an attachment object. Returns { ok, attachment } or { ok: false, error }.
const TEXT_TYPES = { ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json" };
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const LIMITS = { text: 20_000, imageBytes: 280_000 };   // 280 KB of image is about 373 KB of base64, under the server's cap

export async function fileToAttachment(file) {
  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > LIMITS.imageBytes) return { ok: false, error: `${file.name} is larger than ${Math.round(LIMITS.imageBytes / 1000)} KB.` };
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true, attachment: { name: file.name.slice(0, 100), kind: "image", mime: file.type, data: btoa(binary) } };
  }
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (TEXT_TYPES[ext]) {
    const text = await file.text();
    if (text.length > LIMITS.text) return { ok: false, error: `${file.name} is longer than ${LIMITS.text} characters.` };
    return { ok: true, attachment: { name: file.name.slice(0, 100), kind: "text", mime: TEXT_TYPES[ext], data: text } };
  }
  return { ok: false, error: `${file.name}: only .txt, .md, .csv, .json, PNG, JPEG and WebP are supported.` };
}
