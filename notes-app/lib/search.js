// Search over notes. No libraries: tokenizing, a light stemmer, chunking, and BM25 ranking are all here.
//
// How it works:
//   1. Each note is split into chunks (paragraph-sized pieces). Chunks, not whole notes, are what we rank,
//      because a long note about many things should match on the one paragraph that is relevant.
//   2. Every chunk is turned into terms (lowercased, accents folded, stop words removed, endings trimmed).
//   3. BM25 scores a chunk for a query: rare terms count more (idf), repeated terms help with diminishing returns (k1),
//      and long chunks are not unfairly favoured (b).
//   4. A note's score is its best chunk's score. The best chunk also becomes the snippet.

const STOP = new Set(("a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when where which who will with you your about can do does how not").split(" "));

// Trim common English endings so "meetings", "meeting" and "meet" meet in the middle. Crude on purpose: the same
// function runs on notes and queries, so what matters is that it is consistent, not linguistically perfect.
export function stem(w) {
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  const hasVowel = (x) => /[aeiouy]/.test(x);
  const undouble = (x) => (/([^aeiou])\1$/.test(x) ? x.slice(0, -1) : x);
  // Steps run in order on the running result, so "meetings" -> "meeting" -> "meet" ends where "meeting" ends.
  // 1. plurals
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (/(?:ch|sh|x|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w) && w.length > 3) w = w.slice(0, -1);
  // 2. -ing and -ed, only when what is left still looks like a word
  if (w.endsWith("ing") && w.length > 5 && hasVowel(w.slice(0, -3))) w = undouble(w.slice(0, -3));
  if (w.endsWith("ed") && w.length > 4 && hasVowel(w.slice(0, -2))) w = undouble(w.slice(0, -2));
  // 3. a trailing silent e, so "virtualize" and "virtualized" agree
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Returns [{ term, start, end }] with offsets into the ORIGINAL text, so matches can be highlighted exactly.
export function tokenize(text, { keepStop = false } = {}) {
  const out = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = fold(m[0]);
    if (!keepStop && STOP.has(word)) continue;
    out.push({ term: stem(word), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Query terms: stop words removed, unless that leaves nothing ("to be or not to be").
export function queryTerms(q) {
  let t = tokenize(q).map((x) => x.term);
  if (t.length === 0) t = tokenize(q, { keepStop: true }).map((x) => x.term);
  return [...new Set(t)];
}

// ---- chunking
export const CHUNK = { target: 300, max: 600 };

function splitLong(text, max) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < 1) cut = max;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function chunkBody(body, { target = CHUNK.target, max = CHUNK.max } = {}) {
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).flatMap((p) => (p.length > max ? splitLong(p, max) : [p]));
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) { chunks.push(cur); cur = ""; }
    cur = cur ? cur + "\n\n" + p : p;
    if (cur.length >= target) { chunks.push(cur); cur = ""; }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---- index
export function buildIndex(notes) {
  const chunks = [];
  for (const note of notes) {
    const pieces = chunkBody(note.body);
    if (pieces.length === 0) pieces.push("");   // a note with only a title is still findable
    pieces.forEach((text, i) => {
      // Title and tags count too, and the title counts double: a note titled "Visa renewal" should win for "visa".
      const terms = [
        ...tokenize(note.title).map((t) => t.term), ...tokenize(note.title).map((t) => t.term),
        ...note.tags.flatMap((t) => tokenize(t).map((x) => x.term)),
        ...tokenize(text).map((t) => t.term),
      ];
      const tf = new Map();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      chunks.push({ noteId: note.id, title: note.title, tags: note.tags, index: i, text, tf, len: terms.length || 1 });
    });
  }
  const df = new Map();
  for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = chunks.reduce((n, c) => n + c.len, 0) / (chunks.length || 1);
  return { chunks, df, avgLen, N: chunks.length };
}

const K1 = 1.5, B = 0.75;
function scoreChunk(index, chunk, terms) {
  let score = 0, matched = 0;
  for (const t of terms) {
    const f = chunk.tf.get(t);
    if (!f) continue;
    matched++;
    const df = index.df.get(t);
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
    score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * chunk.len) / index.avgLen)));
  }
  return { score, matched };
}

// Rank chunks for a query. Returns [{ chunk, score, matched }] best first, only chunks that match at least one term.
export function rankChunks(index, query) {
  const terms = queryTerms(query);
  if (terms.length === 0) return { terms, ranked: [] };
  const ranked = [];
  for (const chunk of index.chunks) {
    const { score, matched } = scoreChunk(index, chunk, terms);
    if (matched > 0) ranked.push({ chunk, score, matched });
  }
  ranked.sort((a, b) => b.score - a.score || a.chunk.noteId.localeCompare(b.chunk.noteId) || a.chunk.index - b.chunk.index);
  return { terms, ranked };
}

// Highlight ranges for the query's terms inside some text: [[start, end], ...] in that text's own offsets.
export function highlightRanges(text, terms) {
  const want = new Set(terms);
  return tokenize(text, { keepStop: true }).filter((t) => want.has(t.term)).map((t) => [t.start, t.end]);
}

// A short window of text around the first match, with ranges relative to the window.
export function snippet(text, terms, width = 220) {
  const ranges = highlightRanges(text, terms);
  if (text.length <= width) return { text, ranges, before: false, after: false };
  const first = ranges.length ? ranges[0][0] : 0;
  let start = Math.max(0, first - 60);
  if (start > 0) { const sp = text.indexOf(" ", start); if (sp !== -1 && sp < first) start = sp + 1; }
  let end = Math.min(text.length, start + width);
  if (end < text.length) { const sp = text.lastIndexOf(" ", end); if (sp > start + width / 2) end = sp; }
  const slice = text.slice(start, end);
  return { text: slice, ranges: ranges.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s - start, e - start]), before: start > 0, after: end < text.length };
}

// Note-level search: the best chunk of each note.
export function searchNotes(index, query, { limit = 20 } = {}) {
  const { terms, ranked } = rankChunks(index, query);
  const seen = new Set(), results = [];
  for (const { chunk, score } of ranked) {
    if (seen.has(chunk.noteId)) continue;
    seen.add(chunk.noteId);
    results.push({
      noteId: chunk.noteId, title: chunk.title, tags: chunk.tags, score: Math.round(score * 1000) / 1000,
      titleRanges: highlightRanges(chunk.title, terms), snippet: snippet(chunk.text, terms),
    });
    if (results.length >= limit) break;
  }
  return results;
}
