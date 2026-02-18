#!/usr/bin/env node
// phext-query: Extract a scroll from a phext by coordinate or search by keyword
// Zero dependencies.
//
// Usage:
//   phext-query <file.phext> --coord 1.1.1/1.1.1/1.1.2    # fetch by coordinate
//   phext-query <file.phext> --search "keyword"             # search all scrolls
//   phext-query <file.phext> --context "keyword" [N]        # search + N surrounding scrolls

import { readFile } from 'fs/promises';

const SCROLL_BREAK     = '\x17';
const SECTION_BREAK    = '\x18';
const CHAPTER_BREAK    = '\x19';
const BOOK_BREAK       = '\x1A';
const VOLUME_BREAK     = '\x1C';
const COLLECTION_BREAK = '\x1D';

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
  const scrolls = splitPhext(phext);

  if (mode === '--coord') {
    const target = args[2];
    if (!target) { console.error('Provide a coordinate'); process.exit(1); }
    const found = scrolls.find(s => coordMatch(s.coord, target));
    if (found) {
      console.log(`--- ${coordStr(found.coord)} ---`);
      console.log(found.content);
    } else {
      console.error(`No scroll at ${target}`);
      console.error(`Available: ${scrolls.slice(0, 5).map(s => coordStr(s.coord)).join(', ')}...`);
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
        console.log(`  ${coordStr(hit.coord)} :: ${matchLine.trim().slice(0, 120)}`);
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
        console.log(`\n--- ${coordStr(s.coord)}${marker} ---`);
        console.log(s.content.slice(0, 500) + (s.content.length > 500 ? '\n[...]' : ''));
      }
    }
  } else if (mode === '--stats') {
    const totalBytes = Buffer.byteLength(phext, 'utf-8');
    const nonEmpty = scrolls.filter(s => s.content.trim().length > 0);
    console.log(`Scrolls: ${scrolls.length} (${nonEmpty.length} non-empty)`);
    console.log(`Size: ${(totalBytes / 1024).toFixed(1)} KB`);
    console.log(`Coordinate range: ${coordStr(scrolls[0].coord)} → ${coordStr(scrolls[scrolls.length - 1].coord)}`);
    const avgLen = Math.round(nonEmpty.reduce((sum, s) => sum + s.content.length, 0) / nonEmpty.length);
    console.log(`Avg scroll: ${avgLen} chars`);
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
