# Training run dashboard

A dashboard for comparing model training runs, with live charts. Plain JavaScript and Node, no dependencies.

The runs are **simulated**. Every metric comes from a made-up formula (`lib/sim.js`), so the curves are not real training data. The dashboard around them is real: live streaming, run comparison, and charts drawn by hand.

```
node server.js      # http://localhost:3400
node --test         # 28 tests
```

## What it does

- **Compare up to 4 runs** on one chart: loss, reward, KL, grad norm, tokens/s, cost.
- **Live runs.** A running run streams new steps over Server-Sent Events. If the connection drops, the browser reconnects and the server sends only the steps it missed.
- **Smoothing and log scale**, like TensorBoard. Smoothing is corrected at the start so a flat line stays flat. The raw line stays faintly visible underneath.
- **Divergence.** A learning rate that is too high blows up; the chart marks the step where it happened. Try 3e-4 or higher in "Start a new run".
- **What is different.** A table that highlights only the settings that differ between the selected runs.
- **Shareable view.** The selected runs, metric, smoothing and scale live in the URL hash.
- **Start and stop runs** from the page (at most 3 training at once).

## Decisions worth explaining

- **Metrics are a pure function of (config, step).** The same inputs always give the same numbers, so a run can be recomputed, a missed range can be re-sent exactly, and tests do not depend on timing.
- **Resume without duplicates or gaps.** Each event carries its step as the SSE `id`. On reconnect the browser sends `Last-Event-ID`; the server replies with steps after that. The client accepts only the next expected step, ignores replays, and reloads the whole run if it ever sees a gap (`appendPoints`).
- **Downsampling keeps spikes.** Long lines are cut to about one point per pixel by keeping the lowest and highest point of each bucket. Averaging would hide a loss spike, which is the thing you are looking for.
- **The chart is drawn by hand** (SVG, about 130 lines). The slow part (axes and lines) is redrawn when data changes; the crosshair is a separate layer, so moving the mouse is cheap. Updates are batched to one draw per animation frame.
- **Not only color.** Each run has a color and a line style (solid, dashed, dotted, dash-dot), shown in the legend and tooltip. Run status is a word plus a shape.
- **Keyboard and screen readers.** Focus the chart and use the arrow keys (Shift for 10 steps, Home/End) to read values; the values are announced. The summary and settings tables give the same numbers as text.
- **One validation file, two places.** `public/js/config.js` checks the new-run form in the browser and the same file checks it again on the server.
- **Small API surface.** Creating or stopping a run needs a custom header (`X-Requested-With`), so another site cannot do it from a form. Request bodies are capped at 2 KB. A strict Content-Security-Policy lets the page load only its own scripts and connect only to itself.

## Layout

| Path | What it is |
| --- | --- |
| `lib/sim.js` | The simulated metrics: loss, reward, KL, grad norm, tokens/s, cost, checkpoints, divergence |
| `lib/runs.js` | Run store, clock, subscribers, limits |
| `server.js` | Static files, REST API, event stream |
| `public/js/chart.js` | The SVG chart |
| `public/js/series.js` | Smoothing, downsampling, ticks, formatting, config diff, summaries |
| `public/js/config.js` | Settings rules, shared by browser and server |
| `public/app.js` | State, rendering, live connections |
| `public/ds/` | The design system components from this repo |

## Not done

- No real training: nothing here trains a model or reads real logs.
- Runs live in memory and reset when the server restarts.
- No login. It is a local demo.
- The chart has no zoom or brush selection.
