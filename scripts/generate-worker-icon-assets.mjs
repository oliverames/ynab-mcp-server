#!/usr/bin/env node
// Regenerates worker/src/connector-icon-assets.js from codex/assets/icon.png.
//
// The source is a 1024px rounded-rect app tile with 101px of transparent margin
// on every side (macOS icon grid). Web icons are far smaller than that, so the
// margin is trimmed and the tile is scaled to fill each canvas. The apple-touch
// icon is an opaque full-bleed square, because iOS applies its own mask and
// fills transparent pixels black.
//
// The vector favicon (/favicon.svg) and the /assets/ynab-tree-icon-v2.png
// alias are not derived from the tile; they are carried over unchanged from the
// existing generated module so this script never alters them.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "codex", "assets", "icon.png");
const outputPath = join(repoRoot, "worker", "src", "connector-icon-assets.js");

// Tile bounds inside the 1024px source, and the inset that clears the rounded
// corners so the apple-touch crop is fully opaque (verified below).
const TILE = { size: 822, offset: 101 };
const APPLE_TOUCH_INSET = 58;

const PNG_OUTPUT = [
  "-strip", "-depth", "8",
  "-define", "png:exclude-chunks=date,time",
  "-define", "png:color-type=6",
];

const rasterVariants = [
  { name: "CONNECTOR_ICON_PNG", filename: "icon-512.png", size: 512 },
  { name: "CONNECTOR_FAVICON_16_PNG", filename: "favicon-16x16.png", size: 16 },
  { name: "CONNECTOR_FAVICON_32_PNG", filename: "favicon-32x32.png", size: 32 },
  { name: "CONNECTOR_FAVICON_48_PNG", filename: "favicon-48x48.png", size: 48 },
  { name: "CONNECTOR_FAVICON_64_PNG", filename: "favicon-64x64.png", size: 64 },
  { name: "CONNECTOR_FAVICON_96_PNG", filename: "favicon-96x96.png", size: 96 },
  { name: "CONNECTOR_FAVICON_128_PNG", filename: "favicon-128x128.png", size: 128 },
  { name: "CONNECTOR_FAVICON_256_PNG", filename: "favicon-256x256.png", size: 256 },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function exportedAsset(name, buffer) {
  return `export const ${name}_SHA256 = "${sha256(buffer)}";\n` +
    `const ${name}_BASE64 = "${buffer.toString("base64")}";\n` +
    `export const ${name} = decodeBase64(${name}_BASE64);\n`;
}

const magick = (...args) => execFileAsync("magick", args.flat());
const temporaryDirectory = await mkdtemp(join(tmpdir(), "ynab-connector-icons-"));

try {
  const tilePath = join(temporaryDirectory, "tile.png");
  await magick(
    sourcePath,
    "-crop", `${TILE.size}x${TILE.size}+${TILE.offset}+${TILE.offset}`, "+repage",
    "-strip", tilePath,
  );

  const generated = [];
  for (const variant of rasterVariants) {
    const path = join(temporaryDirectory, variant.filename);
    await magick(tilePath, "-filter", "Lanczos", "-resize", `${variant.size}x${variant.size}`, PNG_OUTPUT, path);
    generated.push({ name: variant.name, buffer: await readFile(path) });
  }

  const cropSize = TILE.size - 2 * APPLE_TOUCH_INSET;
  const applePath = join(temporaryDirectory, "apple-touch-icon.png");
  await magick(
    tilePath,
    "-crop", `${cropSize}x${cropSize}+${APPLE_TOUCH_INSET}+${APPLE_TOUCH_INSET}`, "+repage",
    "-filter", "Lanczos", "-resize", "180x180",
    "-alpha", "off", PNG_OUTPUT, applePath,
  );
  const { stdout: minAlpha } = await execFileAsync("magick", [
    applePath, "-alpha", "extract", "-format", "%[fx:minima]", "info:",
  ]);
  if (Number(minAlpha) !== 1) {
    throw new Error(`The apple-touch crop is not fully opaque (min alpha ${minAlpha}); raise APPLE_TOUCH_INSET.`);
  }
  generated.push({ name: "CONNECTOR_APPLE_TOUCH_ICON_PNG", buffer: await readFile(applePath) });

  // A single 32x32 frame. The six-frame variant (16,32,48,64,128,256) produced
  // an uncompressed 370 KB ICO, which is large enough that icon resolvers give
  // up rather than decode it. sosumi.ai, whose connector icon does render in
  // Claude, serves exactly one 32x32 frame at 4,286 bytes. See WORKLOG
  // 2026-07-30.
  const icoPath = join(temporaryDirectory, "favicon.ico");
  await magick(
    tilePath, "-filter", "Lanczos", "-resize", "32x32", "-strip",
    "-define", "icon:auto-resize=32", icoPath,
  );
  generated.push({ name: "CONNECTOR_FAVICON_ICO", buffer: await readFile(icoPath) });

  // Carried over unchanged from the existing module (see the header comment).
  const existing = await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
  generated.push({ name: "CONNECTOR_FAVICON_SVG", buffer: Buffer.from(existing.CONNECTOR_FAVICON_SVG) });
  generated.push({ name: "CONNECTOR_TREE_4096_PNG", buffer: Buffer.from(existing.CONNECTOR_TREE_4096_PNG) });

  const output = [
    "// Generated by scripts/generate-worker-icon-assets.mjs. Run `npm run build:worker-icons`.",
    "// Source: codex/assets/icon.png, trimmed to the tile and scaled to fill each canvas.",
    "// CONNECTOR_FAVICON_SVG and CONNECTOR_TREE_4096_PNG are carried over unchanged.",
    "",
    "function decodeBase64(value) {",
    "  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));",
    "}",
    "",
    ...generated.map(({ name, buffer }) => exportedAsset(name, buffer)),
  ].join("\n");

  await writeFile(outputPath, output);
  console.log(`Generated ${outputPath} from ${sourcePath}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
