#!/usr/bin/env node
/**
 * Real-Safari smoke test.
 *
 * Playwright's WebKit is close to Safari but not identical - it did not reproduce
 * the iOS PDF bug (a ReadableStream async-iteration gap); only *real* Safari did.
 * This drives actual Safari via safaridriver through the browser-API-heavy flow
 * (pdf.js extract -> chunk -> in-browser embed) so that class of bug can't ship.
 *
 * Run before mini-PC deploys: `npm run smoke:safari`
 *
 * Prereqs (one-time): `sudo safaridriver --enable`, then Safari -> Develop ->
 * "Allow Remote Automation". A dev server must be running (default :8080) so the
 * un-bundled `/src` modules can be imported. Override with SMOKE_URL=...
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const URL = process.env.SMOKE_URL || "http://localhost:8080";
const PORT = 4455;
const PDF_B64 = readFileSync("tests/e2e/fixtures/sample.pdf").toString("base64");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wd = async (method, path, body) => {
  const r = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};

try {
  const r = await fetch(URL);
  if (!r.ok) throw new Error(String(r.status));
} catch {
  console.error(`✗ No dev server at ${URL}. Start one first: npm run dev`);
  process.exit(2);
}

const driver = spawn("safaridriver", ["-p", String(PORT)], { stdio: "ignore" });
let failed = false;
try {
  await sleep(2500);
  const sess = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "safari" } },
  });
  const id = sess.value?.sessionId;
  if (!id) {
    console.error(
      "✗ Could not start a Safari session. Run `sudo safaridriver --enable` and " +
        "enable Safari → Develop → 'Allow Remote Automation'.",
      JSON.stringify(sess.value || sess).slice(0, 300),
    );
    process.exit(2);
  }
  try {
    await wd("POST", `/session/${id}/timeouts`, { script: 120000 });
    await wd("POST", `/session/${id}/url`, { url: URL });
    await sleep(2500);
    const script = `var b64=arguments[0],cb=arguments[arguments.length-1];
      (async()=>{try{
        var ex=await import('/src/lib/documents/extract.ts');
        var ch=await import('/src/lib/documents/chunker.ts');
        var em=await import('/src/lib/embedding/embedder.ts');
        var bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
        var file=new File([bin],'sample.pdf',{type:'application/pdf'});
        var r1=await ex.extractText(file);
        var chunks=ch.chunkText(r1.text);
        var emb=await em.embedBatch(chunks.map(function(c){return c.text;}));
        cb({ok:true,chunks:chunks.length,dims:emb[0]&&emb[0].length});
      }catch(e){cb({ok:false,message:String(e&&e.message||e)});}})();`;
    const res = await wd("POST", `/session/${id}/execute/async`, { script, args: [PDF_B64] });
    const v = res.value || {};
    if (v.ok) {
      console.log(
        `✓ real Safari: PDF extract→chunk→embed OK (${v.chunks} chunk(s), ${v.dims}-dim)`,
      );
    } else {
      failed = true;
      console.error(`✗ real Safari FAILED: ${v.message}`);
    }
  } finally {
    await wd("DELETE", `/session/${id}`);
  }
} finally {
  driver.kill();
}
process.exit(failed ? 1 : 0);
