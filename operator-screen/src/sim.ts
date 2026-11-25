const out = document.getElementById("result")!;
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-sim]")) {
  b.addEventListener("click", async () => {
    const action = b.dataset.sim!;
    const r = await fetch(`/sim/${action}`, { method: "POST", body: "{}" });
    out.textContent = r.ok ? `${b.textContent}: sent` : `${b.textContent}: failed (${r.status})`;
  });
}
