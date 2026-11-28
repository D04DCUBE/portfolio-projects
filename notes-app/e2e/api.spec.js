// API tests: notes, search and grounded answers over real HTTP, no browser.
import { test, expect } from "playwright/test";

const H = { "X-Requested-With": "notes" };
const PASSWORD = "correct horse battery";
let n = 0;
const email = () => `api-${Date.now()}-${n++}@example.test`;

async function signUp(request) {
  const r = await request.post("/api/signup", { headers: H, data: { email: email(), password: PASSWORD } });
  expect(r.status()).toBe(201);
}
async function addNote(request, note) {
  const r = await request.post("/api/notes", { headers: H, data: note });
  expect(r.status()).toBe(201);
  return (await r.json()).note;
}

test("auth: sign up, me, log out; notes need a session", async ({ request }) => {
  expect((await request.get("/api/notes")).status()).toBe(401);
  await signUp(request);
  expect((await request.get("/api/me")).status()).toBe(200);
  await request.post("/api/logout", { headers: H, data: {} });
  expect((await request.get("/api/me")).status()).toBe(401);
});

test("CSRF: writes need JSON and the custom header", async ({ request }) => {
  expect((await request.post("/api/signup", { data: { email: email(), password: PASSWORD } })).status()).toBe(403);
  expect((await request.post("/api/signup", { headers: { ...H, "Content-Type": "text/plain" }, data: "x" })).status()).toBe(415);
});

test("notes: create, read, update, filter by tag, delete", async ({ request }) => {
  await signUp(request);
  const note = await addNote(request, { title: "Acme recruiter call", body: "Jordan Lee is the recruiter at Acme.", tags: ["jobs"] });
  await addNote(request, { title: "Groceries", body: "Milk and eggs.", tags: ["home"] });
  expect((await (await request.get(`/api/notes/${note.id}`)).json()).note.body).toContain("Jordan Lee");

  const updated = await request.patch(`/api/notes/${note.id}`, { headers: H, data: { title: "Acme call notes" } });
  expect((await updated.json()).note.title).toBe("Acme call notes");

  const jobs = (await (await request.get("/api/notes?tag=jobs")).json()).notes;
  expect(jobs.map((x) => x.title)).toEqual(["Acme call notes"]);

  expect((await request.delete(`/api/notes/${note.id}`, { headers: H })).status()).toBe(200);
  expect((await request.get(`/api/notes/${note.id}`)).status()).toBe(404);
});

test("notes: invalid input is refused", async ({ request }) => {
  await signUp(request);
  expect((await request.post("/api/notes", { headers: H, data: { title: "" } })).status()).toBe(400);
  expect((await request.post("/api/notes", { headers: H, data: { title: "x", tags: ["not a tag!"] } })).status()).toBe(400);
});

test("search finds a note by its body and marks the match", async ({ request }) => {
  await signUp(request);
  await addNote(request, { title: "Acme recruiter call", body: "Jordan Lee is the recruiter at Acme.", tags: [] });
  const results = (await (await request.get("/api/search?q=jordan")).json()).results;
  expect(results).toHaveLength(1);
  expect(results[0].title).toBe("Acme recruiter call");
  expect((await request.get("/api/search?q=")).status()).toBe(400);
});

test("ask answers only from the notes, with a cited source", async ({ request }) => {
  await signUp(request);
  const note = await addNote(request, { title: "Acme recruiter call", body: "Jordan Lee is the recruiter at Acme.", tags: [] });
  const r = await (await request.post("/api/ask", { headers: H, data: { question: "Who is the recruiter at Acme?" } })).json();
  expect(r.answer).toContain("Jordan Lee");
  expect(r.answer).toMatch(/\[1\]/);
  expect(r.sources[0].noteId).toBe(note.id);

  const none = await (await request.post("/api/ask", { headers: H, data: { question: "What is the capital of Mongolia?" } })).json();
  expect(none).toEqual({ answer: "I couldn't find anything about that in your notes.", sources: [] });
});

test("one user cannot read another user's notes, even by id", async ({ playwright, baseURL }) => {
  const alice = await playwright.request.newContext({ baseURL });
  const bob = await playwright.request.newContext({ baseURL });
  await signUp(alice); await signUp(bob);
  const note = await addNote(alice, { title: "Private", body: "Secret plans.", tags: [] });
  expect((await bob.get(`/api/notes/${note.id}`)).status()).toBe(404);
  expect((await (await bob.get("/api/search?q=secret")).json()).results).toHaveLength(0);
  const asked = await (await bob.post("/api/ask", { headers: H, data: { question: "What are the secret plans?" } })).json();
  expect(asked.sources).toEqual([]);
  await alice.dispose(); await bob.dispose();
});

test("static: security headers and no path traversal", async ({ request }) => {
  const r = await request.get("/");
  expect(r.headers()["content-security-policy"]).toContain("script-src 'self'");
  for (const path of ["/../server.js", "/%2e%2e/server.js"]) expect((await request.get(path)).status()).toBe(404);
});
