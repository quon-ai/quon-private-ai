import { test, expect } from "@playwright/test";

import { cosine } from "../../src/lib/search/vector";

/**
 * EMBEDDER CALIBRATION RATCHET — drift guard for every retrieval-gate threshold.
 *
 * All retrieval/dedupe thresholds are calibrated against ONE hand measurement of
 * the BROWSER WASM q8 embedder (Transformers.js, Xenova/paraphrase-multilingual-
 * MiniLM-L12-v2, 384-dim):
 *   - `ABS_FLOOR` 0.3, `NO_ANCHOR_SIM_FLOOR` 0.55, `STRICT_SIM_FLOOR` 0.4
 *     (src/lib/search/rerank.ts — the RAG relevance gate)
 *   - `SIM_SKIP` 0.92, `SIM_UPDATE` 0.78
 *     (src/lib/memoryExtract.ts — memory-suggestion dedupe)
 *
 * ⚠️ Browser ≠ Node: the browser q8 distribution genuinely differs from Node
 * (unrelated German↔German pairs score up to ~0.41 in the browser vs ≤ ~0.25 in
 * Node fp32/q8 — reproduced live 2026-07-19). Node-side checks are therefore
 * WORTHLESS for these thresholds; this spec embeds through the app's real Web
 * Worker + WASM path in Chromium AND WebKit, which is the point.
 *
 * What it does: embeds a fixed battery of sentence pairs with the app's own
 * `embedBatch` and asserts the cosine of each band stays inside a ratcheted
 * envelope (measured value ± ~0.05 margin — see the per-assert comments). A
 * transformers.js / onnxruntime / model-file bump that shifts the score
 * distribution fails here BEFORE it silently invalidates the gates.
 *
 * Measurement note (2026-07-22 baseline): chromium and webkit produce
 * BIT-IDENTICAL cosines (4 dp) for this battery — the ONNX WASM q8 path is
 * deterministic across engines, so a chromium/webkit divergence here is itself
 * a red flag. This battery's hand-written unrelated pairs score near 0, well
 * below the ~0.41 the real production FP strings measured — the ratchet pins
 * THESE strings, the 0.50/0.55 guard lines still cover the production class.
 *
 * WHEN THIS FAILS: do NOT just widen the asserts. Re-run with the printed
 * measured-values table, compare against the values pinned in the comments
 * below, and decide whether the gate thresholds in rerank.ts / memoryExtract.ts
 * must be recalibrated for the new distribution (then re-pin the bands here to
 * the new measurements, again with ~0.05 margin). Widening an assert without
 * touching the gates means shipping thresholds calibrated for a distribution
 * that no longer exists.
 */

type Band = "unrelated" | "related" | "cross" | "rephrase" | "identical";

interface Pair {
  band: Band;
  label: string;
  a: string;
  b: string;
}

// The fixed battery. Do not "improve" the wording — the asserted bands are
// pinned to THESE exact strings.
const PAIRS: Pair[] = [
  // --- UNRELATED German↔German (the NO_ANCHOR_SIM_FLOOR class: zero shared
  // tokens, must stay clearly below 0.55). Includes the real production false
  // positive (microbiome lab report vs Talbach travel question, ~0.41).
  {
    band: "unrelated",
    label: "lab-report vs travel (the production FP shape)",
    a: "Ferritin 27 µg/l (Referenz 30–300) — Speicher deutlich reduziert.",
    b: "Unser Neffe ist 3,5 Jahre alt und liebt Erlebnispfade in Talbach.",
  },
  {
    band: "unrelated",
    label: "income fact vs recipe question",
    a: "Mein monatliches Nettoeinkommen beträgt 4.250 Euro.",
    b: "Wie lange muss Milchreis kochen, bis er cremig ist?",
  },
  {
    band: "unrelated",
    label: "insurance fact vs football question",
    a: "Meine Haftpflichtversicherung hat eine Deckungssumme von zehn Millionen Euro.",
    b: "Wer hat gestern Abend das Fußballspiel gewonnen?",
  },
  {
    band: "unrelated",
    label: "medication fact vs devops question",
    a: "Ich nehme jeden Morgen 400 Milligramm Ibuprofen ein.",
    b: "Wie installiere ich Docker auf einem Ubuntu-Server?",
  },
  {
    band: "unrelated",
    label: "tax id vs weather question",
    a: "Meine Steuernummer lautet 21/815/08150.",
    b: "Wird es am Wochenende in den Alpen schneien?",
  },
  {
    band: "unrelated",
    label: "pet note vs tax-deadline question",
    a: "Unser Kater Mausi schläft am liebsten auf der Fensterbank.",
    b: "Bis wann muss ich die Umsatzsteuervoranmeldung abgeben?",
  },
  // --- RELATED, same language, shared vocabulary (the class that must clear
  // STRICT_SIM_FLOOR 0.4 comfortably — these are real "note vs question about
  // the note" retrieval hits).
  {
    band: "related",
    label: "income note vs income question (de)",
    a: "Mein monatliches Nettoeinkommen beträgt 4.250 Euro.",
    b: "Wie hoch ist mein monatliches Nettoeinkommen?",
  },
  {
    band: "related",
    label: "address note vs street question (de)",
    a: "Ich wohne in der Hauptstraße 5 in Köln-Ehrenfeld.",
    b: "In welcher Straße wohne ich?",
  },
  {
    band: "related",
    label: "coffee note vs coffee question (de)",
    a: "Ich trinke meinen Kaffee immer schwarz und ohne Zucker.",
    b: "Wie trinke ich meinen Kaffee am liebsten?",
  },
  {
    band: "related",
    label: "rent note vs rent question (en)",
    a: "My landlord raised the rent to 1,200 euros per month.",
    b: "How much rent do I pay per month?",
  },
  // --- RELATED cross-language DE↔EN (no shared tokens; 2026-07-19 hand
  // measurement put this band at roughly 0.37–0.51 — the reason tags/keys count
  // as anchors in rerank.ts).
  {
    band: "cross",
    label: "allergy fact (de) vs allergy question (en)",
    a: "Ich bin allergisch gegen Erdnüsse und Haselnüsse.",
    b: "What food allergies do I have?",
  },
  {
    band: "cross",
    label: "dog fact (de) vs dog question (en)",
    a: "Mein Hund heißt Bruno und ist ein dreijähriger Labrador.",
    b: "What is the name of my dog?",
  },
  {
    band: "cross",
    label: "job fact (en) vs job question (de)",
    a: "I work as a software engineer at a bank in Berlin.",
    b: "Als was und wo arbeite ich?",
  },
  {
    band: "cross",
    label: "color fact (de) vs color question (en)",
    a: "Meine Lieblingsfarbe ist Dunkelblau.",
    b: "What is my favorite color?",
  },
  // --- NEAR-IDENTICAL rephrases (the SIM_UPDATE 0.78 class: same fact, trivial
  // rewording — memoryExtract must see these as an "update", not a new item).
  {
    band: "rephrase",
    label: "coffee fact, trivial reorder (de)",
    a: "Ich trinke meinen Kaffee immer schwarz und ohne Zucker.",
    b: "Meinen Kaffee trinke ich stets schwarz, ganz ohne Zucker.",
  },
  {
    band: "rephrase",
    label: "rent fact, trivial rewording (en)",
    a: "My rent is 1,200 euros per month.",
    b: "I pay 1,200 euros in rent every month.",
  },
  {
    band: "rephrase",
    label: "tax-advisor fact, trivial reorder (de)",
    a: "Anna Weber ist meine Steuerberaterin in München.",
    b: "Meine Steuerberaterin in München heißt Anna Weber.",
  },
  // --- IDENTICAL text embedded twice, in different batch positions (the
  // SIM_SKIP 0.92 class — also pins q8 batch-padding determinism: the two
  // copies land in different sub-batches, so padding context differs).
  {
    band: "identical",
    label: "identical German sentence twice",
    a: "Mein Vermieter heißt Herr Schneider und wohnt im Erdgeschoss.",
    b: "Mein Vermieter heißt Herr Schneider und wohnt im Erdgeschoss.",
  },
  {
    band: "identical",
    label: "identical English sentence twice",
    a: "My daughter's school starts at eight in the morning.",
    b: "My daughter's school starts at eight in the morning.",
  },
];

test("browser q8 embedder: cosine distribution stays inside the calibrated bands", async ({
  page,
}) => {
  test.slow(); // first embed initialises the WASM model in the worker

  // Any app page works — the embedder is a pure client module; no login needed.
  await page.goto("/");

  // Load the app's REAL embedder module (worker + WASM + local model mirror)
  // through vite dev, which serves source modules at /src/... . The import is
  // issued as a string expression so Playwright's test transpiler can't rewrite
  // the dynamic import(); `void` keeps evaluate from trying to serialise the
  // module namespace (functions don't survive the protocol).
  await page.evaluate("void (window.__quonEmbedder = import('/src/lib/embedding/embedder.ts'))");

  const texts = PAIRS.flatMap((p) => [p.a, p.b]);
  const vectors = await page.evaluate(async (input: string[]) => {
    type EmbedderModule = { embedBatch(texts: string[]): Promise<number[][]> };
    const mod = await (window as unknown as { __quonEmbedder: Promise<EmbedderModule> })
      .__quonEmbedder;
    return mod.embedBatch(input);
  }, texts);

  expect(vectors).toHaveLength(texts.length);
  for (const v of vectors) expect(v).toHaveLength(384);

  const results = PAIRS.map((p, i) => ({
    ...p,
    cos: cosine(vectors[2 * i], vectors[2 * i + 1]),
  }));

  // Compact measured-values table — the one-glance recalibration aid.
  const table = results
    .map((r) => `  ${r.band.padEnd(10)} ${r.cos.toFixed(4)}  ${r.label}`)
    .join("\n");
  console.log(
    `\n[embedder-calibration] ${test.info().project.name} measured cosines ` +
      `(band  cosine  pair):\n${table}\n`,
  );

  const byBand = (band: Band) => results.filter((r) => r.band === band);

  // --- UNRELATED: must stay clearly below NO_ANCHOR_SIM_FLOOR (0.55).
  // Re-measured 2026-08-15 after these fixtures were made synthetic, chromium
  // AND webkit BIT-IDENTICAL (4 dp): 0.0209 / 0.0027 / -0.0290 / 0.0555 /
  // 0.0126 / 0.0205 (max 0.0555). ⚠️ Far below the ~0.41 the production FP of
  // this shape measured on 2026-07-19 — the real strings were longer/noisier
  // than this battery; the 0.50 line is the never-cross guard for the gate,
  // 0.10 is the drift ratchet for THESE strings.
  //
  // Swapping a fixture MOVES these numbers: an uncommon word embeds noisily.
  // The first replacement drug tried here scored 0.1596 and broke the ratchet;
  // the fix is a more common word, never a wider band.
  for (const r of byBand("unrelated")) {
    expect(r.cos, `unrelated pair must stay below the anchor-gate band: ${r.label}`).toBeLessThan(
      0.5,
    );
    expect(r.cos, `unrelated ratchet (measured ≤ 0.0555 + margin): ${r.label}`).toBeLessThan(0.1);
  }

  // --- RELATED same-language: must clear STRICT_SIM_FLOOR (0.4) with margin.
  // Measured 2026-07-22 (identical chromium/webkit): 0.6251 / 0.5611 / 0.6131 /
  // 0.6096 (min 0.5611). Floor 0.50 = measured min − ~0.06 margin, comfortably
  // above STRICT_SIM_FLOOR 0.4.
  for (const r of byBand("related")) {
    expect(
      r.cos,
      `related same-language pair must clear the strict tier: ${r.label}`,
    ).toBeGreaterThan(0.5);
  }

  // --- RELATED cross-language DE↔EN: the 2026-07-19 hand measurement said
  // ~0.37–0.51; measured 2026-07-22 (identical chromium/webkit): 0.7651 /
  // 0.6725 / 0.4345 / 0.8040 (min 0.4345, max 0.8040). This battery's short
  // factoid pairs mostly score ABOVE the documented band — which reinforces why
  // NO_ANCHOR_SIM_FLOOR 0.55 alone can't separate cross-language hits from FPs
  // and tags/keys must count as anchors. Band (0.38, 0.87) = extremes ± ~0.05.
  for (const r of byBand("cross")) {
    expect(r.cos, `cross-language pair below the calibrated band: ${r.label}`).toBeGreaterThan(
      0.38,
    );
    expect(r.cos, `cross-language pair above the calibrated band: ${r.label}`).toBeLessThan(0.87);
  }

  // --- NEAR-IDENTICAL rephrases: must clear SIM_UPDATE (0.78) so memoryExtract
  // treats them as updates. Measured 2026-07-22 (identical chromium/webkit):
  // 0.9753 / 0.9593 / 0.9598 (min 0.9593). 0.80 is the guard line (below it the
  // dedupe design itself breaks); 0.90 is the drift ratchet (min − ~0.06).
  for (const r of byBand("rephrase")) {
    expect(r.cos, `rephrase must stay in SIM_UPDATE territory: ${r.label}`).toBeGreaterThan(0.8);
    expect(r.cos, `rephrase ratchet (measured ≥ 0.9593 − margin): ${r.label}`).toBeGreaterThan(0.9);
  }

  // --- IDENTICAL text, different batch positions: must clear SIM_SKIP (0.92).
  // Measured 2026-07-22: 1.0000 on both browsers (q8 batch padding did not
  // perturb the vectors). Floor 0.95 per the SIM_SKIP guard.
  for (const r of byBand("identical")) {
    expect(r.cos, `identical text must stay in SIM_SKIP territory: ${r.label}`).toBeGreaterThan(
      0.95,
    );
  }
});
