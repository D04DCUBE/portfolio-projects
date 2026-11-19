// Input validation. Never trust the client: every field is checked on the server.
import { COLUMNS } from "./store.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials({ email, password } = {}, { strict }) {
  if (typeof email !== "string" || typeof password !== "string") return "Email and password are required.";
  if (email.length > 254 || !EMAIL.test(email)) return "Enter a valid email address.";
  if (strict && (password.length < 10 || password.length > 200)) return "Password must be 10 to 200 characters.";
  return null;
}

export function validateCardFields(body = {}, { requireTitle }) {
  const out = {};
  if (body.title !== undefined || requireTitle) {
    if (typeof body.title !== "string") return { error: "Title is required." };
    const t = body.title.trim();
    if (t.length < 1 || t.length > 120) return { error: "Title must be 1 to 120 characters." };
    out.title = t;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.length > 2000) return { error: "Description must be text up to 2000 characters." };
    out.description = body.description.trim();
  }
  if (body.column !== undefined) {
    if (!COLUMNS.includes(body.column)) return { error: "Unknown column." };
    out.column = body.column;
  }
  if (body.index !== undefined) {
    if (!Number.isInteger(body.index) || body.index < 0 || body.index > 1000) return { error: "Invalid position." };
    out.index = body.index;
  }
  return { value: out };
}
