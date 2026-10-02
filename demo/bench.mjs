// Headless Chrome runner for demo/bench.ts. Usage: node demo/bench.mjs [url] [label]
// `npm run bench` starts vite on a spare strictPort (5560-5564), runs the bench, prints a markdown table, stops vite.
// Pass a URL to use an already running server instead.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
let vite;
let url = process.argv[2];
if (!url) {
  for (let port = 5560; port <= 5564 && !vite; port++) {
    try { vite = await createServer({ root: "demo", logLevel: "silent", server: { port, strictPort: true } }); await vite.listen(); url = `http://localhost:${port}/bench.html`; } catch { vite = undefined; }
  }
  if (!vite) throw new Error("no free port in 5560-5564");
}
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 500);
const p = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1500,900", "--enable-precise-memory-info", "--js-flags=--expose-gc", "--user-data-dir=" + mkdtempSync(join(tmpdir(), "bench-chrome-")), "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Page.navigate", { url }); await sleep(2500);
  const r = await send("Runtime.evaluate", { expression: "runBench()", awaitPromise: true, returnByValue: true, timeout: 300000 });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  const out = r.result.result.value;
  console.log("| scenario | mean ms | p95 ms | max ms |\n|---|---|---|---|");
  for (const [k, v] of Object.entries(out)) console.log(typeof v === "object" ? `| ${k} | ${v.mean} | ${v.p95} | ${v.max} |` : `| ${k} | ${v} | | |`);
  console.log("\n" + JSON.stringify(out));
} finally { p.kill(); await vite?.close(); }
