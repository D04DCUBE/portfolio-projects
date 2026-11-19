# Notes

Notes with ranked search and an "ask your notes" box that answers from your own notes and cites them. Plain Node and browser JavaScript, **no dependencies**, no API key.

```
cd projects/notes-app
node server.js        # http://localhost:3300
npm test              # 39 tests
```

Create an account, add a few notes, then try searching for a word or asking a question like "who is my recruiter?".

## How search works (`lib/search.js`)

1. **Chunking.** Each note is split into paragraph-sized chunks (about 300 characters, never over 600). Ranking chunks, not whole notes, means a long note matches on the one paragraph that is relevant, and that paragraph becomes the snippet.
2. **Terms.** Text is lowercased, accents are folded (`café` matches `cafe`), stop words are dropped, and a small stemmer trims endings so `meetings`, `meeting` and `meet` agree. The same function runs on notes and queries, so consistency matters more than linguistic accuracy. Offsets point into the original text, which makes exact highlighting possible.
3. **BM25 ranking.** A term scores higher when it is rare across your notes (idf), appears more in the chunk (with diminishing returns), and the chunk is not unusually long. The title counts double and tags count too. A note's score is its best chunk.
4. **Results** carry the title, tags, a snippet around the first match, and the character ranges to highlight. The server sends ranges, not HTML. The browser builds `<mark>` elements from them, so there is no way for note text to inject markup.
5. **Index cache.** One index per user, rebuilt only when that user's notes change (a version counter in the store).

## How "ask your notes" works (`lib/answer.js`)

1. **Retrieve.** Take the best chunks for the question, at most two per note and three in total. A chunk must match at least half of the question's terms. Without that check a question about something you never wrote down would still return the "least bad" chunk.
2. **Generate.** A provider turns the question and chunks into an answer. The built-in one is **extractive**: it picks the sentences that overlap most with the question, so it can only say what your notes say. A real model would implement the same `answer()` function using `buildPrompt()`.
3. **Check citations.** Citation numbers the model invented are removed. An answer with no valid citation is replaced by "I couldn't find anything about that in your notes."
4. **Prompt safety.** `buildPrompt()` wraps each note in `<note>` tags with `<`, `>` and `&` escaped, and tells the model the contents are data. Text inside a note cannot close the tag and pose as instructions. A test tries exactly that.

## Security (same patterns as the Kanban app)

- Passwords hashed with scrypt and a per-user salt; sessions are random tokens, only their SHA-256 is stored; cookie is HttpOnly and SameSite=Strict.
- CSRF: JSON content type plus a custom header, on top of SameSite.
- **Ownership on every query.** Each store function takes the user id. Other users' notes return 404, never 403, and never appear in search or answers. Tests cover read, edit, delete, search and ask across two users.
- Validation on the server for every field, rate limits on sign-up, login, search and ask, a cap of 500 notes per user, a 100 KB request limit.
- CSP, nosniff and no-referrer headers, path traversal protection.

## Tests

- `search.test.js`: stemming, tokenizing with offsets, chunking, ranking, idf, title and tag weighting, snippets and highlight ranges, odd input, and a **recall@3 check**: ten labelled questions, and the right note must be in the top three for every one.
- `answer.test.js`: retrieval thresholds, answers contain only sentences found in notes, not-found cases, citation cleaning, prompt escaping.
- `api.test.js`: auth, CSRF, CRUD, validation, isolation between users, index updates after create, edit and delete, rate limits, the 500-note cap.

## Limits (honest list)

- The index is rebuilt in memory when notes change. Fine for hundreds of notes, not millions. A larger system would keep an inverted index on disk.
- Keyword search only. It will not find "automobile" when you wrote "car". Adding embeddings would handle meaning, and could be combined with BM25 (hybrid search). The retrieval code would not change shape: it still returns ranked chunks.
- The built-in answerer cannot summarise or combine facts across notes; it quotes. That is why it is trustworthy and also why it is limited.
- The stemmer is English only and crude.
- One JSON file as the database, one server process.
