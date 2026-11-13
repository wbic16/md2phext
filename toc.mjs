#!/usr/bin/env node
// phext-toc: Print the table of contents from a phext file
// Built on libphext: the TOC is the phext's home scroll.
//
// Usage: phext-toc <file.phext>

import { readFile } from 'fs/promises';
import { Phext, Coordinate } from 'libphext';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: phext-toc <file.phext>');
    process.exit(1);
  }

  const phext = await readFile(file, 'utf-8');
  // TOC is the first scroll: the scroll at the home coordinate,
  // parsed out by libphext rather than by scanning for a break byte.
  const toc = new Phext().explode(phext).get(new Coordinate().to_string()) ?? '';
  console.log(toc);
}

main().catch(err => { console.error(err); process.exit(1); });
