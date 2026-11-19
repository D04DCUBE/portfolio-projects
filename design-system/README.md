# Design system: tokens and Web Components

A small, dependency-free design system: a set of **design tokens** (CSS custom properties)
and four accessible **native Web Components** (`ds-button`, `ds-text-field`, `ds-alert`, `ds-dialog`)
with light and dark themes. It is a personal learning project.

Why no React, Tailwind or build step? Plain browser features are the foundation under all of
those tools, and a component that works in plain HTML works in React, Angular, Next.js and an
extension popup alike. Learn this layer first. Wrapping it for React is exercise 1 below.

## Run it
```
cd design-system
python3 -m http.server 8000
```
Open `http://localhost:8000/`. (ES modules do not load from `file://`, so use the server.)

## What is in it
| Path | What it is |
|---|---|
| `tokens.css` | Color, type, space and shape tokens. Light theme, dark theme (OS setting or `data-theme`), reduced motion |
| `components/ds-button.js` | Button: variants, sizes, disabled, form-associated (`type="submit"` works) |
| `components/ds-text-field.js` | Labelled input with hint and error, form-associated, built-in validation |
| `components/ds-alert.js` | Info, success, warning and error messages, announced correctly to screen readers |
| `components/ds-dialog.js` | Modal dialog on the native `<dialog>`: focus trap, Esc, focus return |
| `index.html` | The documentation page, which is also the manual test page |

## How it is built
- **Tokens, not hard-coded colors.** Components read `var(--ds-primary)` and friends. Custom properties
  pass through the Shadow DOM boundary, so changing a token (or the theme) restyles every component.
- **Native elements inside.** The button wraps a real `<button>`, the field a real `<input>`, the dialog a real
  `<dialog>`. Keyboard and screen reader behavior come from the browser, not from re-implementing it.
- **Shadow DOM** keeps component styles from leaking out and page styles from leaking in.
- **ElementInternals** (`formAssociated`) lets a custom element take part in a form: it submits a value,
  validates, and resets like a native control.

## Accessibility checks that were run
- Every color pair in both themes was calculated against WCAG AA (4.5:1 for text, 3:1 for interface edges
  and focus rings). All pass. Re-run it any time you change a token: `node scripts/contrast.js` (from this folder).
- Automated browser checks: all four elements register; role queries find a named button, a labelled text field,
  `alert` for errors and `status` for the rest; Enter activates a button; the dialog opens, moves focus inside,
  closes on Esc and returns focus to the opener; an empty required form is blocked with inline errors and a valid
  one submits; errors set `aria-invalid` and `aria-describedby`; dark theme tokens reach inside the shadow DOM.
- Not yet done: a screen reader pass (VoiceOver), an automated axe audit, and testing in Firefox and Safari.
  Say so if asked. These are the honest next steps.

## Things to be able to explain
- **What is a design token?** A named design decision (a color, a spacing step) stored once and reused. Components
  reference the name, so theming and rebranding are one-file changes.
- **Why do tokens work through Shadow DOM?** CSS custom properties inherit across the shadow boundary; ordinary
  selectors do not. That is the officially supported theming channel for Web Components.
- **Why wrap a native `<button>`?** Free keyboard support, focus handling, disabled behavior and an accessible role.
  A `<div>` that looks like a button would need all of that rebuilt.
- **What does `delegatesFocus` do?** Focusing the host (by script, or by clicking its label) focuses the first
  focusable thing inside the shadow root.
- **Why re-dispatch `change` and `close`?** Some native events are not `composed`, so they stop at the shadow
  boundary. The component re-dispatches them so outside code can listen normally. `input` and `click` already cross.
- **Why `formAssociated` and `ElementInternals`?** Without it a custom element is invisible to its `<form>`: no value
  in `FormData`, no validation, no reset.
- **Why not rely on color alone?** Alerts have an icon and a hidden "Error:" prefix. About 1 in 12 men has some color
  vision deficiency, and color-only meaning also fails in high-contrast mode.
- **Why `textContent`, never `innerHTML`?** The components show text that may come from the page or a server. `textContent`
  cannot inject markup.
- **Web Components vs React components?** Web Components are a browser standard: framework-agnostic and the right
  choice for a shared design system used by several apps or injected into other people's pages (like a browser extension).
  React components are easier for rich app state. Many teams build the primitives as Web Components and wrap them.

## Exercises (one per day)
1. **React wrapper.** Use `<ds-button>` and `<ds-text-field>` inside a small Vite and React app. Notice what is awkward
   (events, boolean attributes) and how React 19 improves it.
2. **A third component:** `ds-tabs` with arrow-key navigation and the ARIA tabs pattern, or `ds-checkbox` with a form value.
3. **Tokens as JSON.** Move tokens into a JSON file and generate `tokens.css` from it with a small script (the idea behind Style Dictionary).
4. **Automated accessibility audit** with axe-core in a Playwright test, run on every component state.
5. **Document with a story page** per component showing every state (default, hover, focus, disabled, error).
6. **Publish** the components as an npm package with a proper `package.json` (`type: module`, `exports`) and a version.
7. **Tailwind bridge:** map the tokens to a Tailwind theme so utility classes and components share one palette.
