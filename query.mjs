#!/usr/bin/env node
// phext-query: Extract a scroll from a phext by coordinate or search by keyword
// Zero dependencies.
//
// Usage:
//   phext-query <file.phext> --coord 1.1.1/1.1.1/1.1.2    # fetch by coordinate
//   phext-query <file.chain>  --coord $2:1.1.1/1.1.1/1.1.2 # universe 2 of a chain (multiverse addressing)
//   phext-query <file.phext> --search "keyword"             # search all scrolls
//   phext-query <file.phext> --context "keyword" [N]        # search + N surrounding scrolls

import { readFile } from 'fs/promises';

const SCROLL_BREAK     = '\x17';
const SECTION_BREAK    = '\x18';
const CHAPTER_BREAK    = '\x19';
const BOOK_BREAK       = '\x1A';
const VOLUME_BREAK     = '\x1C';
const COLLECTION_BREAK = '\x1D';
const CHAIN_BREAK = '\x02';
const CHAIN_CLOSE = '\x03';

function splitPhext(phext) {
  // Split into scrolls with coordinates
  const scrolls = [];
  let coord = { scroll: 1, section: 1, chapter: 1, book: 1, volume: 1, collection: 1 };

  let current = '';
  for (let i = 0; i < phext.length; i++) {
    const ch = phext[i];
    if (ch === COLLECTION_BREAK || ch === VOLUME_BREAK || ch === BOOK_BREAK ||
        ch === CHAPTER_BREAK || ch === SECTION_BREAK || ch === SCROLL_BREAK) {
      scrolls.push({ coord: { ...coord }, content: current });
      current = '';

      if (ch === COLLECTION_BREAK) {
        coord.collection++; coord.volume = 1; coord.book = 1; coord.chapter = 1; coord.section = 1; coord.scroll = 1;
      } else if (ch === VOLUME_BREAK) {
        coord.volume++; coord.book = 1; coord.chapter = 1; coord.section = 1; coord.scroll = 1;
      } else if (ch === BOOK_BREAK) {
        coord.book++; coord.chapter = 1; coord.section = 1; coord.scroll = 1;
      } else if (ch === CHAPTER_BREAK) {
        coord.chapter++; coord.section = 1; coord.scroll = 1;
      } else if (ch === SECTION_BREAK) {
        coord.section++; coord.scroll = 1;
      } else {
        coord.scroll++;
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    scrolls.push({ coord: { ...coord }, content: current });
  }
  return scrolls;
}

function coordStr(c) {
  return `${c.collection}.${c.volume}.${c.book}/${c.chapter}.${c.section}.${c.scroll}`;
}

function coordMatch(a, target) {
  return coordStr(a) === target;
}

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

// Parse a possibly universe-qualified target: "$2:1.1.1/1.1.2/1.1.1" or a bare
// coordinate (universe 1). The scroll parser tracks collection..scroll, so a
// full 9-part address has its leading library/shelf/series group dropped when
// it is the implicit 1.1.1.
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
  const groups = coord.split('/');
  if (groups.length === 3 && groups[0] === '1.1.1') {
    coord = groups.slice(1).join('/');
  }
  return { universe, coord };
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
  const scrolls = members.flatMap((member, i) =>
    splitPhext(member).map(s => ({ ...s, universe: i + 1 })));
  const display = s => isChain ? `$${s.universe}:${coordStr(s.coord)}` : coordStr(s.coord);

  if (mode === '--coord') {
    const rawTarget = args[2];
    if (!rawTarget) { console.error('Provide a coordinate'); process.exit(1); }
    const parsed = parseTarget(rawTarget);
    if (!parsed) { console.error(`Bad address: ${rawTarget} (expected $N:coordinate or coordinate)`); process.exit(1); }
    if (parsed.universe > members.length) {
      console.error(`Universe $${parsed.universe} not in this stream (${members.length} universe(s))`);
      process.exit(1);
    }
    const found = scrolls.find(s => s.universe === parsed.universe && coordMatch(s.coord, parsed.coord));
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
