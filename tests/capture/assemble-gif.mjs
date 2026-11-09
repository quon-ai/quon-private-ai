// Turn the frames the capture spec writes into the README GIF, or into a
// contact sheet for a quick look.
//
//   node tests/capture/assemble-gif.mjs gif   <frames-dir> <out.gif> [width=960] [colours=128] [start=0] [minDelay=0] [tail=0]
//   node tests/capture/assemble-gif.mjs sheet <frames-dir> <out.png> 3,12,40
//
// <frames-dir>/index.json lists the PNGs as [{ name, t }] with t in
// milliseconds since the first frame. Identical consecutive frames are merged
// into one longer delay, so a 30 s take with long holds stays small. Uses
// sharp, which @huggingface/transformers brings along; add it as a dev
// dependency if that ever changes.
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"),
);
const sharp = require("sharp");
const [, , cmd, dir, out, ...rest] = process.argv;
if (!cmd || !dir || !out) {
  console.error("usage: assemble-gif.mjs gif|sheet <frames-dir> <out> [options]");
  process.exit(2);
}
const idx = JSON.parse(readFileSync(`${dir}/index.json`, "utf8"));

if (cmd === "sheet") {
  const pick = (rest[0] ?? "0").split(",").map(Number);
  const W = 640;
  const H = 400;
  const tiles = await Promise.all(
    pick.map(async (i, k) => ({
      input: await sharp(`${dir}/${idx[i].name}`).resize(W, H).png().toBuffer(),
      left: (k % 3) * W,
      top: Math.floor(k / 3) * H,
    })),
  );
  await sharp({
    create: {
      width: W * 3,
      height: H * Math.ceil(pick.length / 3),
      channels: 3,
      background: "#000",
    },
  })
    .composite(tiles)
    .png()
    .toFile(out);
} else if (cmd === "gif") {
  const opts = Object.fromEntries(rest.map((a) => a.split("=")));
  const width = Number(opts.width ?? 960);
  const colours = Number(opts.colours ?? 128);
  const startMs = Number(opts.start ?? 0);
  const minDelay = Number(opts.minDelay ?? 0);
  const height = Math.round((800 * width) / 1280);
  const sel = idx.filter((f) => f.t >= startMs);
  const frames = [];
  const delays = [];
  for (let i = 0; i < sel.length; i++) {
    const raw = await sharp(`${dir}/${sel[i].name}`)
      .resize(width, height, { kernel: "lanczos3" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const next = i + 1 < sel.length ? sel[i + 1].t : sel[i].t + 150;
    const d = next - sel[i].t;
    if (frames.length && raw.equals(frames[frames.length - 1])) {
      delays[delays.length - 1] += d;
      continue;
    }
    // fps cap: fold a frame into the previous one while that one is still short
    if (frames.length && delays[delays.length - 1] < minDelay) {
      frames[frames.length - 1] = raw;
      delays[delays.length - 1] += d;
      continue;
    }
    frames.push(raw);
    delays.push(d);
  }
  delays[delays.length - 1] += Number(opts.tail ?? 0);
  await sharp(Buffer.concat(frames), {
    raw: { width, height: height * frames.length, channels: 3, pageHeight: height },
  })
    .gif({
      delay: delays.map((d) => Math.round(d / 10) * 10),
      loop: 0,
      colours,
      effort: 10,
      dither: Number(opts.dither ?? 0.5),
      interFrameMaxError: Number(opts.ife ?? 4),
    })
    .toFile(out);
  const total = delays.reduce((a, b) => a + b, 0);
  console.log(
    JSON.stringify({
      out,
      bytes: statSync(out).size,
      frames: frames.length,
      captured: sel.length,
      durationS: total / 1000,
      width,
      height,
    }),
  );
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
