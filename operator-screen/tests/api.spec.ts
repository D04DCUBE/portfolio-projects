// API tests: the HTTP surface and the WebSocket protocol, with no browser.
import { test, expect } from "playwright/test";
import { connect, machine, reset, sim, snapshot } from "./helpers.ts";

test.beforeEach(async ({ request }) => { await reset(request); });

test.describe("HTTP", () => {
  test("serves the screen with a strict security policy", async ({ request }) => {
    const r = await request.get("/");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/html");
    expect(r.headers()["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("serves only the known assets", async ({ request }) => {
    for (const ok of ["/app.js", "/app.css", "/sim"]) expect((await request.get(ok)).status(), ok).toBe(200);
    for (const bad of ["/package.json", "/server/server.ts", "/src/main.tsx", "/../package.json", "/dist/app.js"]) {
      expect((await request.get(bad)).status(), bad).toBe(404);
    }
  });

  test("the simulator rejects unknown actions and bad JSON", async ({ request }) => {
    expect((await request.post("/sim/explode", { data: {} })).status()).toBe(404);
    expect((await request.post("/sim/fault", { data: Buffer.from("{not json") })).status()).toBe(400);
    expect((await request.post("/sim/fault", { data: Buffer.from('"a string"') })).status()).toBe(400);
    expect((await request.post("/sim/fault", { data: Buffer.from("[1,2]") })).status()).toBe(400);
    expect((await machine(request)).health.status).toBe("ok");
  });

  test("reset returns the machine to its seed state", async ({ request }) => {
    await sim(request, "fault");
    expect((await machine(request)).health.status).toBe("fault");
    await reset(request);
    const s = await machine(request);
    expect(s.health.status).toBe("ok");
    expect(s.session).toBeNull();
    expect(s.queue).toHaveLength(5);
  });

  test("fault text from the simulator is length-limited", async ({ request }) => {
    await sim(request, "fault", { code: "X".repeat(50), message: "m".repeat(500) });
    const s = await machine(request);
    expect(s.health.status).toBe("fault");
    if (s.health.status === "fault") {
      expect(s.health.code.length).toBeLessThanOrEqual(12);
      expect(s.health.message.length).toBeLessThanOrEqual(80);
    }
  });
});

test.describe("WebSocket protocol", () => {
  test("a new connection gets the full state at once", async ({ baseURL }) => {
    const c = await connect(baseURL!);
    const s = snapshot(await c.next());
    expect(s.queue).toHaveLength(5);
    expect(s.session).toBeNull();
    c.close();
  });

  test("a bad PIN is rejected with a reason, only to the sender", async ({ baseURL }) => {
    const a = await connect(baseURL!), b = await connect(baseURL!);
    await a.next(); await b.next();
    a.send({ type: "signIn", pin: "0000" });
    expect(await a.next()).toEqual({ type: "rejected", command: "signIn", reason: "bad_pin" });
    await expect(b.next(undefined, 300)).rejects.toThrow(/timed out/);
    a.close(); b.close();
  });

  test("every connected client sees every change", async ({ baseURL }) => {
    const a = await connect(baseURL!), b = await connect(baseURL!);
    await a.next(); await b.next();
    a.send({ type: "signIn", pin: "1234" });
    const [sa, sb] = [snapshot(await a.next()), snapshot(await b.next())];
    expect(sa.session?.user).toBe("Maya R.");
    expect(sb.version).toBe(sa.version);
    a.close(); b.close();
  });

  test("a prescription runs on drawer events from the machine", async ({ baseURL, request }) => {
    const c = await connect(baseURL!); await c.next();
    c.send({ type: "signIn", pin: "1234" }); await c.next();
    c.send({ type: "startPrescription", id: "RX-1041" });
    expect(snapshot(await c.next()).active).toEqual({ prescriptionId: "RX-1041", step: "picking" });
    await sim(request, "drawer-open");
    expect(snapshot(await c.next()).active?.step).toBe("remove_items");
    await sim(request, "drawer-close");
    const done = snapshot(await c.next());
    expect(done.active).toBeNull();
    expect(done.queue.find((p) => p.id === "RX-1041")?.status).toBe("done");
    c.close();
  });

  test("commands are refused during a fault, and work again after it clears", async ({ baseURL, request }) => {
    const c = await connect(baseURL!); await c.next();
    c.send({ type: "signIn", pin: "1234" }); await c.next();
    await sim(request, "fault"); await c.next();
    c.send({ type: "startPrescription", id: "RX-1041" });
    expect(await c.next()).toEqual({ type: "rejected", command: "startPrescription", reason: "fault_active" });
    await sim(request, "clear-fault"); await c.next();
    c.send({ type: "startPrescription", id: "RX-1041" });
    expect(snapshot(await c.next()).active?.prescriptionId).toBe("RX-1041");
    c.close();
  });

  test("garbage and unknown commands are rejected and the server keeps working", async ({ baseURL }) => {
    const c = await connect(baseURL!); await c.next();
    for (const bad of ["not json", { type: "formatDisk" }, { type: "signIn", pin: 1234 }, { type: "restock", slot: "A1", count: "5" }]) {
      c.send(bad);
      expect((await c.next()).type).toBe("rejected");
    }
    c.send({ type: "signIn", pin: "1234" });
    expect(snapshot(await c.next()).session?.user).toBe("Maya R.");
    c.close();
  });

  test("the socket endpoint is only /ws", async ({ baseURL }) => {
    await expect(connect(baseURL! + "/nope")).rejects.toThrow();
  });
});
