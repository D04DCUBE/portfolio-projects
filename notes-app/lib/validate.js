// Input validation. Every field is checked on the server, whatever the browser did.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const LIMITS = { title: 120, body: 20_000, tags: 8, question: 300, query: 200 };

export function validateCredentials({ email, password } = {}, { strict }) {
  if (typeof email !== "string" || typeof password !== "string") return "Email and password are required.";
  if (email.length > 254 || !EMAIL.test(email)) return "Enter a valid email address.";
  if (strict && (password.length < 10 || password.length > 200)) return "Password must be 10 to 200 characters.";
  return null;
}

export function validateNote(body = {}, { requireTitle }) {
  const out = {};
  if (body.title !== undefined || requireTitle) {
    if (typeof body.title !== "string") return { error: "Title is required." };
    const t = body.title.trim();
    if (t.length < 1 || t.length > LIMITS.title) return { error: `Title must be 1 to ${LIMITS.title} characters.` };
    out.title = t;
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string" || body.body.length > LIMITS.body) return { error: `Note text must be up to ${LIMITS.body} characters.` };
    out.body = body.body.replace(/\r\n/g, "\n").trim();
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > LIMITS.tags) return { error: `At most ${LIMITS.tags} tags.` };
    const tags = [];
    for (const raw of body.tags) {
      const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!TAG.test(t)) return { error: "Tags are 1-24 characters: a-z, 0-9 and dashes." };
      if (!tags.includes(t)) tags.push(t);
    }
    out.tags = tags;
  }
  return { value: out };
}

export function validateText(v, max, label) {
  if (typeof v !== "string") return { error: `${label} is required.` };
  const t = v.trim();
  if (t.length < 1 || t.length > max) return { error: `${label} must be 1 to ${max} characters.` };
  return { value: t };
}
