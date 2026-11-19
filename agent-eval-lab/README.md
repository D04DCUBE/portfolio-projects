# Agent Eval Lab

A small MCP server, an agent loop, an eval suite, and a viewer that compares two runs and steps through what each agent did. TypeScript on Node 22.18+, no dependencies, no API keys.

The "models" are two hand-written policies, not real language models, and the shop (orders, refunds) is invented. The point is the harness around an agent: how you test one, and how you see why a test failed. A real model plugs into the same `Model` interface.

```
node src/run-evals.ts --model careful     # saves runs/careful.json
node src/run-evals.ts --model careless    # saves runs/careless.json
node src/run-evals.ts compare runs/careful.json runs/careless.json
node viewer/server.ts                     # http://localhost:3500
node --test                               # 32 tests
npx tsc --noEmit                          # type-check (needs `typescript`, dev only)
```

## What it shows

`careful` passes 8 of 8 cases. `careless` passes 3 of 8, and the eval output says exactly how it fails:

- It **refunds without checking eligibility first.** On a valid order the outcome is right, but the process check (`check_refund_eligibility before issue_refund`) fails. A test that only looked at the result would miss this.
- It **tells the customer a refund went through when the server refused it.** Two graders catch that: one on the tool call, one on the false claim in the reply.
- It **ignores the amount asked for** and refunds the whole order ($200 instead of $50).

## How it fits together

| Part | File | Job |
| --- | --- | --- |
| Shop | `src/world.ts` | Invented orders and four tools: look up an order, list orders, check refund eligibility, issue a refund. The date is fixed so runs repeat. |
| MCP server | `src/mcp-server.ts` | JSON-RPC 2.0 over stdio, one message per line. Handles `initialize`, `ping`, `tools/list`, `tools/call`. |
| MCP client | `src/mcp-client.ts` | Starts the server as a child process and talks to it. Times out instead of hanging. |
| Agent loop | `src/agent.ts` | Ask the model, run the tool through MCP, repeat. Stops at 8 steps. A tool that throws becomes an error result the model can see. |
| Models | `src/models.ts` | `careful` and `careless` policies. |
| Graders | `src/graders.ts` | Read a finished trace and return pass/fail with a reason. |
| Cases | `src/cases.ts` | 8 customer messages with their graders. |
| Runner | `src/run-evals.ts` | Runs the suite, saves a run file, compares two runs. Exits 1 on a failure or regression, so it can gate CI. |
| Viewer | `viewer/` | Pick two runs, see which cases changed, step both trajectories side by side. |

## Decisions worth explaining

- **Grade the trace, not just the answer.** A trace holds every tool call and result. That lets a grader check order ("eligibility before refund"), count calls, and compare the reply with what the tools actually returned.
- **One fresh server per case.** A refund in one case cannot change the data in another. A test checks this.
- **Money-moving rules live in the server.** The agent can ask for a refund it should not make; the server refuses it. The evals measure whether the agent behaves, not whether the guard works. The guard has its own tests.
- **Same inputs, same run.** The policies are deterministic and the shop's date is fixed, so a test asserts two runs are identical.
- **The viewer writes run data with `textContent`, never as HTML**, and its server only serves three fixed files plus `runs/*.json`. File names with `/` or `..` are refused (tested).
- **No build step.** Node strips the types. The viewer server does the same for the browser. This limits the code to type-only syntax (`import type`, no enums), which `erasableSyntaxOnly` enforces.

## Not done

- No real model. An adapter would turn the tool list into the provider's tool format and map its reply to a `ModelTurn`. I did not write one because I could not run it here.
- Eight cases is a demo, not a benchmark. There is no repeat-run statistics, which a real (non-deterministic) model would need.
- The graders check wording with regular expressions. A model that words things differently could fail a correct answer; real suites often add a model-based grader for that.
- The MCP server covers tools only: no resources, prompts, authentication, or HTTP transport.
