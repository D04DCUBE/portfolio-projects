// API tests: the JSON API over real HTTP, no browser.
import { test, expect } from "playwright/test";

const H = { "X-Requested-With": "kanban" };
let n = 0;
const email = () => `api-${Date.now()}-${n++}@example.test`;
const PASSWORD = "correct horse battery";

// Each test gets its own signed-in user; the request context keeps the session cookie.
async function signUp(request, address = email()) {
  const r = await request.post("/api/signup", { headers: H, data: { email: address, password: PASSWORD } });
  expect(r.status()).toBe(201);
  return address;
}

test.describe("auth", () => {
  test("sign up, me, log out, log back in", async ({ request }) => {
    const address = await signUp(request);
    expect((await (await request.get("/api/me")).json()).user.email).toBe(address);
    expect((await request.post("/api/logout", { headers: H, data: {} })).status()).toBe(200);
    expect((await request.get("/api/me")).status()).toBe(401);
    const back = await request.post("/api/login", { headers: H, data: { email: address, password: PASSWORD } });
    expect(back.status()).toBe(200);
  });

  test("the session cookie is HttpOnly and SameSite=Strict", async ({ request }) => {
    const r = await request.post("/api/signup", { headers: H, data: { email: email(), password: PASSWORD } });
    const cookie = r.headers()["set-cookie"];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  test("a wrong password and an unknown email get the same answer", async ({ request }) => {
    const address = await signUp(request);
    await request.post("/api/logout", { headers: H, data: {} });
    const wrong = await request.post("/api/login", { headers: H, data: { email: address, password: "not the password" } });
    const unknown = await request.post("/api/login", { headers: H, data: { email: email(), password: PASSWORD } });
    expect(wrong.status()).toBe(401);
    expect(unknown.status()).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  test("a short password and a duplicate email are refused", async ({ request }) => {
    expect((await request.post("/api/signup", { headers: H, data: { email: email(), password: "short" } })).status()).toBe(400);
    const address = await signUp(request);
    const again = await request.post("/api/signup", { headers: H, data: { email: address, password: PASSWORD } });
    expect(again.status()).toBeGreaterThanOrEqual(400);
  });

  test("card endpoints need a session", async ({ request }) => {
    expect((await request.get("/api/cards")).status()).toBe(401);
  });
});

test.describe("CSRF defences", () => {
  test("writes without the custom header are refused", async ({ request }) => {
    const r = await request.post("/api/signup", { data: { email: email(), password: PASSWORD } });
    expect(r.status()).toBe(403);
  });

  test("writes that are not JSON are refused", async ({ request }) => {
    const r = await request.post("/api/signup", { headers: { ...H, "Content-Type": "application/x-www-form-urlencoded" }, data: "email=a&password=b" });
    expect(r.status()).toBe(415);
  });
});

test.describe("cards", () => {
  test("create, edit, move and delete a card", async ({ request }) => {
    await signUp(request);
    let r = await request.post("/api/cards", { headers: H, data: { title: "Write tests", column: "todo" } });
    expect(r.status()).toBe(201);
    const card = (await r.json()).cards[0];
    expect(card).toMatchObject({ title: "Write tests", column: "todo" });

    r = await request.patch(`/api/cards/${card.id}`, { headers: H, data: { title: "Write Playwright tests" } });
    expect((await r.json()).cards[0].title).toBe("Write Playwright tests");

    r = await request.patch(`/api/cards/${card.id}`, { headers: H, data: { column: "done", index: 0 } });
    expect((await r.json()).cards[0].column).toBe("done");

    r = await request.delete(`/api/cards/${card.id}`, { headers: H });
    expect((await r.json()).cards).toHaveLength(0);
  });

  test("invalid cards are refused", async ({ request }) => {
    await signUp(request);
    expect((await request.post("/api/cards", { headers: H, data: { title: "" } })).status()).toBe(400);
    expect((await request.post("/api/cards", { headers: H, data: { title: "x", column: "nowhere" } })).status()).toBe(400);
    expect((await request.post("/api/cards", { headers: { ...H, "Content-Type": "application/json" }, data: Buffer.from("{bad") })).status()).toBe(400);
  });

  test("one user cannot see or change another user's cards", async ({ playwright, baseURL }) => {
    const alice = await playwright.request.newContext({ baseURL });
    const bob = await playwright.request.newContext({ baseURL });
    await signUp(alice); await signUp(bob);
    const id = (await (await alice.post("/api/cards", { headers: H, data: { title: "Alice only" } })).json()).cards[0].id;
    expect((await (await bob.get("/api/cards")).json()).cards).toHaveLength(0);
    expect((await bob.patch(`/api/cards/${id}`, { headers: H, data: { title: "hacked" } })).status()).toBe(404);
    expect((await bob.delete(`/api/cards/${id}`, { headers: H })).status()).toBe(404);
    expect((await (await alice.get("/api/cards")).json()).cards[0].title).toBe("Alice only");
    await alice.dispose(); await bob.dispose();
  });
});

test.describe("static files", () => {
  test("pages carry security headers", async ({ request }) => {
    const r = await request.get("/");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-security-policy"]).toContain("script-src 'self'");
    expect(r.headers()["x-frame-options"]).toBe("DENY");
  });

  test("path traversal and missing files are 404", async ({ request }) => {
    for (const path of ["/../server.js", "/%2e%2e/server.js", "/nope.html"]) expect((await request.get(path)).status(), path).toBe(404);
  });
});
