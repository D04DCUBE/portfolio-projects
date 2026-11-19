import { test } from "node:test";
import assert from "node:assert/strict";
import { stem, tokenize, queryTerms, chunkBody, buildIndex, searchNotes, rankChunks, snippet, highlightRanges } from "../lib/search.js";
import { NOTES, byTitle } from "./fixtures.js";

const index = buildIndex(NOTES);
const top = (q) => searchNotes(index, q)[0]?.title;

test("stem: plurals and endings meet in the middle", () => {
  for (const [a, b] of [["meetings", "meeting"], ["stories", "story"], ["running", "run"], ["renewing", "renew"], ["renewed", "renew"], ["boxes", "box"], ["passes", "pass"], ["runs", "run"]]) assert.equal(stem(a), stem(b), `${a} vs ${b}`);
  assert.equal(stem("is"), "is"); assert.equal(stem("bus"), "bus"); assert.equal(stem("2019"), "2019"); assert.equal(stem("css"), "css");
});

test("tokenize: folds accents and case, drops stop words, keeps offsets into the original text", () => {
  const text = "The Café is OPEN";
  const toks = tokenize(text);
  assert.deepEqual(toks.map((t) => t.term), ["cafe", "open"]);
  assert.equal(text.slice(toks[0].start, toks[0].end), "Café");
  assert.deepEqual(queryTerms("to be or not to be").length > 0, true, "a query of only stop words still searches");
  assert.deepEqual(queryTerms("meeting meetings Meeting"), ["meet"], "duplicates and word forms collapse");
});

test("chunking: paragraphs merge up to the target, long paragraphs split, nothing is lost", () => {
  assert.deepEqual(chunkBody(""), []);
  assert.deepEqual(chunkBody("one\n\ntwo"), ["one\n\ntwo"]);
  const long = ("This is a sentence. ").repeat(100);
  const chunks = chunkBody(long);
  assert.ok(chunks.length > 2 && chunks.every((c) => c.length <= 600));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), long.replace(/\s+/g, " ").trim());
  const noSpaces = "x".repeat(1500);
  assert.equal(chunkBody(noSpaces).join("").length, 1500, "a word longer than the limit is still cut, not dropped");
  const many = Array.from({ length: 6 }, (_, i) => "para " + i + " " + "y".repeat(200)).join("\n\n");
  assert.ok(chunkBody(many).length >= 2);
});

test("ranking: the right note comes first for natural queries", () => {
  assert.equal(top("who is the recruiter at Acme"), "Acme recruiter call");
  assert.equal(top("when does car insurance renew"), "Car insurance renewal");
  assert.equal(top("react rerender performance"), "React performance notes");
  assert.equal(top("keyboard focus accessibility"), "Accessibility checklist");
  assert.equal(top("password hashing scrypt"), "Kanban project retro");
  assert.equal(top("reconnect backoff"), "Websocket notes");
  assert.equal(top("running schedule"), "Running plan");
  assert.equal(top("team meetings"), "Team sync meeting");
  assert.equal(top("shopping list milk"), "Groceries");
});

test("stemming: other word forms still find the note", () => {
  assert.equal(top("renewing insurance"), "Car insurance renewal");
  assert.equal(top("runs"), "Running plan");
  assert.equal(top("virtualized lists"), "React performance notes");
});

test("title and tags count: a title match outranks a passing mention", () => {
  const idx = buildIndex([
    { id: "a", title: "Passport", body: "Renew before the trip.", tags: [] },
    { id: "b", title: "Trip packing", body: "Charger, adapter, passport, socks, shoes, hat, book, headphones, water bottle.", tags: [] },
  ]);
  assert.equal(searchNotes(idx, "passport")[0].noteId, "a");
  const tagged = buildIndex([{ id: "t", title: "Misc", body: "stuff", tags: ["recipes"] }, { id: "u", title: "Other", body: "stuff", tags: [] }]);
  assert.equal(searchNotes(tagged, "recipes")[0].noteId, "t");
});

test("a rare term beats a common one (idf)", () => {
  const idx = buildIndex([
    { id: "1", title: "A", body: "project project project project plan", tags: [] },
    { id: "2", title: "B", body: "project quokka", tags: [] },
    ...Array.from({ length: 6 }, (_, i) => ({ id: "f" + i, title: "F" + i, body: "project filler words here", tags: [] })),
  ]);
  assert.equal(searchNotes(idx, "project quokka")[0].noteId, "2");
});

test("only notes that match something are returned; unrelated queries return nothing", () => {
  assert.deepEqual(searchNotes(index, "quantum entanglement physics"), []);
  assert.deepEqual(searchNotes(index, "   "), []);
  assert.deepEqual(searchNotes(index, "!!!"), []);
});

test("results: one per note (its best chunk), limited, and deterministic", () => {
  const r = searchNotes(index, "the", { limit: 3 });
  assert.ok(r.length <= 3);
  const all = searchNotes(index, "rate limiter limiting");
  assert.equal(new Set(all.map((x) => x.noteId)).size, all.length);
  assert.deepEqual(searchNotes(index, "project"), searchNotes(index, "project"));
});

test("a note that is only a title is still findable; an empty notebook is fine", () => {
  const idx = buildIndex([{ id: "x", title: "Call dentist", body: "", tags: [] }]);
  assert.equal(searchNotes(idx, "dentist")[0].noteId, "x");
  assert.deepEqual(searchNotes(buildIndex([]), "anything"), []);
});

test("highlights: ranges point at the matching words in the original text, accents and case included", () => {
  const text = "Meetings are every Tuesday. Café meeting later.";
  const ranges = highlightRanges(text, queryTerms("meeting cafe"));
  assert.deepEqual(ranges.map(([s, e]) => text.slice(s, e)), ["Meetings", "Café", "meeting"]);
  const res = searchNotes(index, "recruiter")[0];
  assert.ok(res.snippet.ranges.every(([s, e]) => /recruiter/i.test(res.snippet.text.slice(s, e))));
});

test("snippet: a long chunk is cut around the first match, with ranges moved to match", () => {
  const text = "x ".repeat(200) + "needle in the haystack " + "y ".repeat(200);
  const s = snippet(text, queryTerms("needle"));
  assert.ok(s.text.length <= 230 && s.before && s.after);
  assert.deepEqual(s.ranges.map(([a, b]) => s.text.slice(a, b)), ["needle"]);
  const short = snippet("tiny needle", queryTerms("needle"));
  assert.deepEqual([short.before, short.after], [false, false]);
});

test("scores are finite numbers even with odd input", () => {
  for (const q of ["a", "the the the", "😀", "ñandú", "x".repeat(500)]) {
    const { ranked } = rankChunks(index, q);
    assert.ok(ranked.every((r) => Number.isFinite(r.score)));
  }
});

test("retrieval quality: expected note is in the top 3 for every labelled query (recall@3)", () => {
  const labelled = [
    ["when is the call with the recruiter", "Acme recruiter call"], ["what is my current job title", "Resume updates"],
    ["how do I reduce re-renders", "React performance notes"], ["how should I handle dropped connections", "Websocket notes"],
    ["what did we decide in the sync", "Team sync meeting"], ["how often do I run", "Running plan"],
    ["what is in the load balancer note", "Interview prep: system design"], ["how are passwords stored", "Kanban project retro"],
    ["contrast on themes", "Accessibility checklist"], ["when does the policy renew", "Car insurance renewal"],
  ];
  const misses = labelled.filter(([q, title]) => !searchNotes(index, q, { limit: 3 }).some((r) => r.noteId === byTitle(title).id));
  assert.deepEqual(misses, []);
});

test("stem: leaves short words, numbers and word-like stems alone", () => {
  assert.equal(stem("string"), "string", "'str' is not a word, so -ing stays");
  assert.equal(stem("spring"), "spring");
  assert.equal(stem("virtualize"), stem("virtualized"));
  assert.equal(stem("agree"), stem("agreed"));
  assert.equal(stem("class"), "class");
});
