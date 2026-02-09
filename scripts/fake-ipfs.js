#!/usr/bin/env node
/**
 * Fake IPFS HTTP API server for local development.
 *
 * Implements the subset of the Kubo RPC API used by ipfs-http-client in this
 * project: add, cat, pin/add, pin/rm, pin/ls, id, object/stat.
 *
 * Content is stored in-memory (lost on restart) and CIDv1 (dag-pb,
 * sha2-256, base32) is computed deterministically so the same bytes always
 * produce the same CID – matching what a real IPFS node returns.
 *
 * Usage:
 *   node scripts/fake-ipfs.js          # listens on 5001
 *   IPFS_PORT=5002 node scripts/fake-ipfs.js
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const PORT = parseInt(process.env.IPFS_PORT || "5001", 10);

// ── In-memory store ──────────────────────────────────────────────────────
// key = CID string, value = { data: Buffer, pinned: boolean }
const store = new Map();

// ── CIDv1 computation (dag-pb, sha2-256, base32lower) ────────────────────
// We wrap raw bytes in a minimal UnixFS / dag-pb node to match what
// ipfs-http-client `add()` produces for small payloads (single chunk).

function sha256(buf) {
  return createHash("sha256").update(buf).digest();
}

/**
 * Encode an unsigned varint (used by multihash / CID).
 */
function encodeVarint(n) {
  const out = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n & 0x7f);
  return Buffer.from(out);
}

/**
 * Wrap raw bytes into a minimal UnixFS "file" protobuf, then wrap that
 * into a dag-pb Node protobuf – this mirrors what `ipfs.add()` does for
 * content that fits in a single block.
 *
 * UnixFS protobuf (type=File):
 *   field 1 (varint) = 2 (File)
 *   field 3 (varint) = data length
 *   field 2 (bytes)  = data
 *
 * dag-pb Node protobuf:
 *   field 1 (bytes)  = the UnixFS protobuf above
 */
function wrapDagPb(raw) {
  // UnixFS protobuf
  const type = Buffer.from([0x08, 0x02]); // field1=varint, value=2 (File)
  const dataTag = Buffer.from([0x12]); // field2=bytes tag
  const dataLen = encodeVarint(raw.length);
  const sizeTag = Buffer.from([0x18]); // field3=varint tag
  const sizeVal = encodeVarint(raw.length);
  const unixfs = Buffer.concat([type, dataTag, dataLen, raw, sizeTag, sizeVal]);

  // dag-pb Node: field 1 (Data) = bytes
  const nodeTag = Buffer.from([0x0a]); // field1=bytes tag
  const nodeLen = encodeVarint(unixfs.length);
  return Buffer.concat([nodeTag, nodeLen, unixfs]);
}

/**
 * Compute CIDv1 (dag-pb, sha2-256, base32lower) for raw content bytes.
 */
function computeCID(raw) {
  const dagPb = wrapDagPb(raw);
  const digest = sha256(dagPb);

  // Multihash: 0x12 = sha2-256, 0x20 = 32 bytes
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);

  // CIDv1 prefix: version=1, codec=dag-pb(0x70)
  const cidBytes = Buffer.concat([Buffer.from([0x01, 0x70]), multihash]);

  // base32lower with "b" multibase prefix
  const b32 = "b" + base32Encode(cidBytes);
  return { cid: b32, dagPb, size: dagPb.length };
}

// RFC 4648 base32 (lowercase, no padding)
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += B32[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

// ── Multipart form parser (minimal, handles ipfs-http-client uploads) ────

function parseMultipart(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (true) {
    const idx = buf.indexOf(sep, start);
    if (idx === -1) break;
    if (start > 0) {
      // strip leading \r\n and trailing \r\n before boundary
      let partBuf = buf.slice(start, idx);
      if (partBuf[0] === 0x0d && partBuf[1] === 0x0a) partBuf = partBuf.slice(2);
      if (
        partBuf[partBuf.length - 2] === 0x0d &&
        partBuf[partBuf.length - 1] === 0x0a
      )
        partBuf = partBuf.slice(0, -2);

      // Split headers from body at \r\n\r\n
      const headerEnd = partBuf.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const body = partBuf.slice(headerEnd + 4);
        parts.push(body);
      }
    }
    start = idx + sep.length;
  }
  return parts;
}

// ── Request helpers ──────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function queryParam(url, key) {
  const u = new URL(url, "http://localhost");
  return u.searchParams.get(key);
}

// ── Route handlers ───────────────────────────────────────────────────────

async function handleAdd(req, res) {
  const body = await readBody(req);

  const ct = req.headers["content-type"] || "";
  let raw;

  if (ct.includes("multipart")) {
    const m = ct.match(/boundary=(.+)/);
    const boundary = m ? m[1] : "";
    const parts = parseMultipart(body, boundary);
    raw = parts[0] || body;
  } else {
    raw = body;
  }

  const url = new URL(req.url, "http://localhost");
  const onlyHash = url.searchParams.get("only-hash") === "true";
  const { cid, size } = computeCID(raw);

  if (!onlyHash) {
    store.set(cid, { data: raw, pinned: true });
    log(`ADD  ${cid} (${raw.length} bytes)`);
  } else {
    log(`HASH ${cid} (only-hash, not stored)`);
  }

  // ipfs-http-client expects ndjson lines
  const entry = JSON.stringify({
    Name: "",
    Hash: cid,
    Size: String(size),
  });
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(entry + "\n");
}

function handleCat(_req, res, url) {
  const cid = queryParam(url, "arg");
  if (!cid || !store.has(cid)) {
    return json(res, 404, { Message: `CID not found: ${cid}`, Code: 0 });
  }
  log(`CAT  ${cid}`);
  const { data } = store.get(cid);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function handlePinAdd(_req, res, url) {
  const cid = queryParam(url, "arg");
  if (cid && store.has(cid)) {
    store.get(cid).pinned = true;
  }
  json(res, 200, { Pins: [cid] });
}

function handlePinRm(_req, res, url) {
  const cid = queryParam(url, "arg");
  if (cid && store.has(cid)) {
    store.get(cid).pinned = false;
  }
  json(res, 200, { Pins: [cid] });
}

function handlePinLs(_req, res, url) {
  const arg = queryParam(url, "arg");
  const keys = {};
  if (arg) {
    if (store.has(arg) && store.get(arg).pinned) {
      keys[arg] = { Type: "recursive" };
    }
  } else {
    for (const [cid, entry] of store) {
      if (entry.pinned) keys[cid] = { Type: "recursive" };
    }
  }
  json(res, 200, { Keys: keys });
}

function handleId(_req, res) {
  // ID must be a valid libp2p peer ID (base58btc-encoded identity multihash)
  json(res, 200, {
    ID: "12D3KooW9pP4Seg3kZYhySpuVjn1RPdQBsUFZKiFxGMGQN5MeL6A",
    AgentVersion: "fake-ipfs/1.0.0",
    ProtocolVersion: "ipfs/0.1.0",
    Addresses: ["/ip4/127.0.0.1/tcp/5001"],
  });
}

function handleObjectStat(_req, res, url) {
  const cid = queryParam(url, "arg");
  if (!cid || !store.has(cid)) {
    return json(res, 404, { Message: `CID not found: ${cid}`, Code: 0 });
  }
  const { data } = store.get(cid);
  json(res, 200, {
    Hash: cid,
    NumLinks: 0,
    BlockSize: data.length,
    LinksSize: 0,
    DataSize: data.length,
    CumulativeSize: data.length,
  });
}

// ── Server ───────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[fake-ipfs ${ts}] ${msg}`);
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    return res.end();
  }

  const url = req.url || "/";
  const path = new URL(url, "http://localhost").pathname;

  try {
    if (path === "/api/v0/add") return await handleAdd(req, res);
    if (path === "/api/v0/cat") return handleCat(req, res, url);
    if (path === "/api/v0/pin/add") return handlePinAdd(req, res, url);
    if (path === "/api/v0/pin/rm") return handlePinRm(req, res, url);
    if (path === "/api/v0/pin/ls") return handlePinLs(req, res, url);
    if (path === "/api/v0/id") return handleId(req, res);
    if (path === "/api/v0/object/stat") return handleObjectStat(req, res, url);

    json(res, 404, { Message: `Endpoint not found: ${path}`, Code: 0 });
  } catch (err) {
    console.error("[fake-ipfs] Error:", err);
    json(res, 500, { Message: err.message, Code: 0 });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log(`Port ${PORT} already in use — assuming another fake-ipfs is running.`);
    process.exit(0);
  }
  console.error("[fake-ipfs] Fatal:", err);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Listening on http://0.0.0.0:${PORT}`);
  log(`Implements: add, cat, pin/add, pin/rm, pin/ls, id, object/stat`);
  log(`Store: in-memory (${store.size} objects)`);
});
