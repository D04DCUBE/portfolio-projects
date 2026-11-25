import { createRoot } from "react-dom/client";
import { App } from "./ui/App.tsx";
import { createStore } from "./ui/store.ts";

const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const store = createStore(() => new WebSocket(url));
createRoot(document.getElementById("root")!).render(<App store={store} />);
