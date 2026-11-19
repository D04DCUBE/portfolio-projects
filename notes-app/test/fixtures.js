// A small realistic notebook used by the search and answer tests.
let n = 0;
const note = (title, body, tags = []) => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, title, body, tags });
export const NOTES = [
  note("Interview prep: system design", "Cache read-heavy data close to users.\n\nA load balancer spreads requests across servers. Health checks remove a dead server.\n\nRate limiting protects the API from one noisy client. Use a token bucket.", ["interview"]),
  note("Acme recruiter call", "Recruiter is Jordan Lee. The role is Sr. Frontend Engineer on the Orbit team.\n\nCall is scheduled for Thursday afternoon. Bring the Lead Frontend Engineer resume.", ["jobs"]),
  note("Resume updates", "Title is Lead Frontend Engineer at Example Corp since March 2019.\n\nAdd the browser extension and the design system projects.", ["jobs"]),
  note("Groceries", "Buy milk, eggs, spinach, rice and coffee beans.", []),
  note("Car insurance renewal", "The policy renews in March. Call the agent two weeks before to compare quotes.\n\nKeep the old policy number handy.", ["home"]),
  note("React performance notes", "Re-renders are the usual cause of slow screens. Memoization stops unneeded re-renders.\n\nVirtualize long lists so only visible rows are rendered.", ["react"]),
  note("Accessibility checklist", "Everything must work with the keyboard only. Keep a visible focus outline.\n\nAnnounce changes with aria-live, but not every token while streaming.\n\nCheck colour contrast on both themes.", ["a11y"]),
  note("Kanban project retro", "Passwords are hashed with scrypt and a random salt. Sessions use an HttpOnly cookie.\n\nThe rate limiter slows down password guessing.", ["projects"]),
  note("Websocket notes", "Clients must reconnect with exponential backoff and jitter. Add a heartbeat so dead connections are dropped.\n\nResume with the last message id so nothing is lost.", ["projects"]),
  note("Running plan", "Running three times a week. Long run on Sunday, easy runs on Tuesday and Thursday. Goal is a 5k in December.", ["health"]),
  note("Team sync meeting", "Meetings are every Tuesday at ten. Decision: ship the search feature first.\n\nAction: write the retro for the Kanban project.", ["work"]),
  note("Book list", "Designing Data-Intensive Applications. A Philosophy of Software Design. The Pragmatic Programmer.", ["reading"]),
];
export const byTitle = (t) => NOTES.find((x) => x.title === t);
