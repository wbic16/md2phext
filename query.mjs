#!/usr/bin/env node
// phext-query: Extract a scroll from a phext by coordinate or search by keyword
// Built on libphext: the library parses every phext this tool reads.
//
// Usage:
//   phext-query <file.phext> --coord 1.1.1/1.1.1/1.1.2    # fetch by coordinate
//   phext-query <file.chain>  --coord $2:1.1.1/1.1.1/1.1.2 # universe 2 of a chain (multiverse addressing)
//   phext-query <file.phext> --search "keyword"             # search all scrolls
//   phext-query <file.phext> --context "keyword" [N]        # search + N surrounding scrolls

import { readFile } from 'fs/promises';
import { Phext } from 'libphext';

const phextLib = new Phext();

// Chain framing (libphext-rs 0.6): CHAIN_BREAK separates whole phexts
// (universes) within a chain, CHAIN_CLOSE terminates a chain.
// libphext-node predates chains, so splitting a stream into its
// universes lives here until the JS library reaches parity; everything
// inside a universe is parsed by libphext.
const CHAIN_BREAK = '\x02';
const CHAIN_CLOSE = '\x03';

// Split a stream into its universe (member phext) strings, in order.
// Mirrors libphext parse_chains: CHAIN_CLOSE terminates a chain, CHAIN_BREAK
// separates universes within one; a chain-free file is a single universe.
function splitChain(stream) {
  let body = stream;
  if (body.endsWith(CHAIN_CLOSE)) body = body.slice(0, -1);
  const members = [];
  for (const chainSegment of body.split(CHAIN_CLOSE)) {
    for (const member of chainSegment.split(CHAIN_BREAK)) {
      members.push(member);
    }
  }
  return members;
}

// Display form: these tools have always printed coordinates by their
// collection..scroll tail when the library head is the implicit 1.1.1.
// Anything addressed outside 1.1.1 prints in full.
function displayKey(key) {
  return key.startsWith('1.1.1/') ? key.slice('1.1.1/'.length) : key;
}

// Normalize a user-supplied coordinate to libphext's canonical 9-part
// key: the tools' own 6-part print form (collection.volume.book /
// chapter.section.scroll) names the 1.1.1 library head implicitly.
function toFullKey(coord) {
  const groups = coord.split('/');
  if (groups.length === 2) return `1.1.1/${coord}`;
  return coord;
}

// Parse a possibly universe-qualified target: "$2:1.1.1/1.1.2/1.1.1" or a bare
// coordinate (universe 1). The $N: prefix is multiverse addressing
// (libphext 0.6); the coordinate itself is handed to libphext.
function parseTarget(target) {
  let universe = 1;
  let coord = target;
  if (coord.startsWith('$')) {
    const colon = coord.indexOf(':');
    if (colon < 0) return null;
    universe = parseInt(coord.slice(1, colon), 10);
    if (!Number.isInteger(universe) || universe < 1) return null;
    coord = coord.slice(colon + 1);
  }
  // A malformed coordinate names no scroll: give it a key that can
  // never match, so the caller reports "No scroll at ..." as before.
  if (!/^\d+\.\d+\.\d+(\/\d+\.\d+\.\d+){1,2}$/.test(coord)) return { universe, key: '' };
  return { universe, key: phextLib.to_coordinate(toFullKey(coord)).to_string() };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage:');
    console.error('  phext-query <file.phext> --coord 1.1.1/1.1.1/1.1.2');
    console.error('  phext-query <file.phext> --search "keyword"');
    console.error('  phext-query <file.phext> --context "keyword" [N]');
    console.error('  phext-query <file.phext> --stats');
    process.exit(1);
  }

  const file = args[0];
  const mode = args[1];
  const phext = await readFile(file, 'utf-8');
  const members = splitChain(phext);
  const isChain = members.length > 1 || phext.includes(CHAIN_BREAK) || phext.includes(CHAIN_CLOSE);
  // Parse each universe with libphext: explode gives a coordinate → scroll
  // map in document order.
  const scrolls = members.flatMap((member, i) =>
    [...phextLib.explode(member).entries()].map(([key, content]) => ({ key, content, universe: i + 1 })));
  const display = s => isChain ? `$${s.universe}:${displayKey(s.key)}` : displayKey(s.key);

  if (mode === '--coord') {
    const rawTarget = args[2];
    if (!rawTarget) { console.error('Provide a coordinate'); process.exit(1); }
    const parsed = parseTarget(rawTarget);
    if (!parsed) { console.error(`Bad address: ${rawTarget} (expected $N:coordinate or coordinate)`); process.exit(1); }
    if (parsed.universe > members.length) {
      console.error(`Universe $${parsed.universe} not in this stream (${members.length} universe(s))`);
      process.exit(1);
    }
    const found = scrolls.find(s => s.universe === parsed.universe && s.key === parsed.key);
    if (found) {
      console.log(`--- ${display(found)} ---`);
      console.log(found.content);
    } else {
      console.error(`No scroll at ${rawTarget}`);
      console.error(`Available: ${scrolls.slice(0, 5).map(s => display(s)).join(', ')}...`);
    }
  } else if (mode === '--search') {
    const keyword = args[2]?.toLowerCase();
    if (!keyword) { console.error('Provide a search term'); process.exit(1); }
    const hits = scrolls.filter(s => s.content.toLowerCase().includes(keyword));
    if (hits.length === 0) {
      console.log(`No matches for "${keyword}" across ${scrolls.length} scrolls.`);
    } else {
      console.log(`${hits.length} match(es) for "${keyword}":\n`);
      for (const hit of hits) {
        const lines = hit.content.split('\n');
        const matchLine = lines.find(l => l.toLowerCase().includes(keyword)) || lines[0];
        console.log(`  ${display(hit)} :: ${matchLine.trim().slice(0, 120)}`);
      }
    }
  } else if (mode === '--context') {
    const keyword = args[2]?.toLowerCase();
    const radius = parseInt(args[3] || '1', 10);
    if (!keyword) { console.error('Provide a search term'); process.exit(1); }
    const hitIndices = [];
    scrolls.forEach((s, i) => { if (s.content.toLowerCase().includes(keyword)) hitIndices.push(i); });
    if (hitIndices.length === 0) {
      console.log(`No matches for "${keyword}".`);
    } else {
      const included = new Set();
      for (const idx of hitIndices) {
        for (let j = Math.max(0, idx - radius); j <= Math.min(scrolls.length - 1, idx + radius); j++) {
          included.add(j);
        }
      }
      const sorted = [...included].sort((a, b) => a - b);
      for (const idx of sorted) {
        const s = scrolls[idx];
        const marker = hitIndices.includes(idx) ? ' ← match' : '';
        console.log(`\n--- ${display(s)}${marker} ---`);
        console.log(s.content.slice(0, 500) + (s.content.length > 500 ? '\n[...]' : ''));
      }
    }
  } else if (mode === '--stats') {
    const totalBytes = Buffer.byteLength(phext, 'utf-8');
    const nonEmpty = scrolls.filter(s => s.content.trim().length > 0);
    console.log(`Scrolls: ${scrolls.length} (${nonEmpty.length} non-empty)`);
    if (isChain) console.log(`Universes: ${members.length}`);
    console.log(`Size: ${(totalBytes / 1024).toFixed(1)} KB`);
    console.log(`Coordinate range: ${display(scrolls[0])} → ${display(scrolls[scrolls.length - 1])}`);
    const avgLen = Math.round(nonEmpty.reduce((sum, s) => sum + s.content.length, 0) / nonEmpty.length);
    console.log(`Avg scroll: ${avgLen} chars`);
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
