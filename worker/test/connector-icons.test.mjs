import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import test from "node:test";
import {
  CONNECTOR_FAVICON_SVG_SHA256,
  CONNECTOR_TREE_4096_PNG_SHA256,
} from "../src/brand-assets.js";
import { YnabHandler } from "../src/ynab-handler.js";

const ORIGINS = ["https://ames-ynab.link", "https://ynab.amesvt.com"];
const ASSETS = [
  { path: "/assets/ynab-tree-icon-v2.svg", mime: "image/svg+xml; charset=utf-8", hash: CONNECTOR_FAVICON_SVG_SHA256 },
  { path: "/assets/ynab-tree-icon-v2.png", mime: "image/png", hash: CONNECTOR_TREE_4096_PNG_SHA256 },
];

test("versioned connector icons are public, cross-origin and cacheable without OAuth or secrets", async () => {
  const env = {
    CONNECTOR_BASE_URL: ORIGINS[0],
    CONNECTOR_CANONICAL_URL: ORIGINS[0],
    OAUTH_PROVIDER: new Proxy({}, {
      get() { throw new Error("Public icon requests must not enter OAuth"); },
    }),
  };
  for (const origin of ORIGINS) {
    for (const asset of ASSETS) {
      const url = `${origin}${asset.path}`;
      const response = await YnabHandler.request(url, { headers: { Origin: "https://gemini.google.com" } }, env);
      assert.equal(response.status, 200, asset.path);
      assert.equal(response.headers.get("content-type"), asset.mime);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.match(response.headers.get("content-security-policy"), /default-src 'none'; sandbox/);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("www-authenticate"), null);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 0);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(actualHash, asset.hash);
      assert.equal(response.headers.get("etag"), `"sha256-${actualHash}"`);

      const head = await YnabHandler.request(url, { method: "HEAD" }, env);
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-type"), asset.mime);
      assert.equal(head.headers.get("etag"), response.headers.get("etag"));
      assert.equal((await head.arrayBuffer()).byteLength, 0);

      const unchanged = await YnabHandler.request(url, { headers: { "If-None-Match": response.headers.get("etag") } }, env);
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.headers.get("access-control-allow-origin"), "*");
      assert.equal(unchanged.headers.get("etag"), response.headers.get("etag"));
      assert.equal((await unchanged.arrayBuffer()).byteLength, 0);

      const changed = await YnabHandler.request(url, { headers: { "If-None-Match": '"older-icon"' } }, env);
      assert.equal(changed.status, 200);
      assert.equal(createHash("sha256").update(Buffer.from(await changed.arrayBuffer())).digest("hex"), actualHash);
    }
  }
});

test("the advertised SVG preserves the official vector paths without an embedded bitmap", async () => {
  const source = await readFile(new URL("../../assets/ynab-tree-blurple.svg", import.meta.url), "utf8");
  const response = await YnabHandler.request(`${ORIGINS[0]}/assets/ynab-tree-icon-v2.svg`);
  const svg = await response.text();
  assert.match(svg, /<svg\b[^>]*viewBox="0 -3\.5 576 576"/);
  const paths = (value) => [...value.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(paths(source).length > 10, "the source must contain the actual tree artwork");
  assert.deepEqual(paths(svg), paths(source), "the public vector must preserve every original path");
  assert.doesNotMatch(svg, /<image\b|data:|base64|<script\b|<foreignObject\b|(?:xlink:)?href=/i);
});

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

test("the PNG fallback decodes as 4096 square with opaque vector artwork and transparent padding", async () => {
  const response = await YnabHandler.request(`${ORIGINS[0]}/assets/ynab-tree-icon-v2.png`);
  const png = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const imageData = [];
  let dimensions;
  let ended = false;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= png.length, "every PNG chunk must be complete");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      assert.equal(length, 13);
      dimensions = [data.readUInt32BE(0), data.readUInt32BE(4)];
      assert.deepEqual(dimensions, [4096, 4096]);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0], "8-bit RGBA with standard compression and no interlacing");
    }
    if (type === "IDAT") imageData.push(data);
    offset += length + 12;
    if (type === "IEND") {
      assert.equal(length, 0);
      assert.equal(offset, png.length);
      ended = true;
    }
  }
  assert.ok(ended && dimensions && imageData.length > 0);
  const [width, height] = dimensions;
  const rowLength = width * 4;
  const expectedBytes = height * (rowLength + 1);
  const filtered = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedBytes });
  assert.equal(filtered.length, expectedBytes, "all 4096 image rows must decompress");
  let previous = Buffer.alloc(rowLength);
  let row = Buffer.alloc(rowLength);
  let transparent = 0;
  let treePixels = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (rowLength + 1);
    const filter = filtered[start];
    assert.ok(filter <= 4, `valid PNG filter on row ${y}`);
    for (let x = 0; x < rowLength; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      const correction = filter === 1 ? left : filter === 2 ? above : filter === 3
        ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
      row[x] = (filtered[start + 1 + x] + correction) & 255;
    }
    for (let x = 0; x < rowLength; x += 4) {
      if (row[x + 3] === 0) transparent++;
      if (row[x] === 59 && row[x + 1] === 94 && row[x + 2] === 218 && row[x + 3] === 255) treePixels++;
    }
    [previous, row] = [row, previous];
  }
  assert.ok(transparent > width * height / 4, "the square must retain transparent space around the tree");
  assert.ok(treePixels > width * height / 4, "the fallback must render the blue tree at full resolution");
});
