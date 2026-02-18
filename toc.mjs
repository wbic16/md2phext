#!/usr/bin/env node
// phext-toc: Print the table of contents from a phext file
// Zero dependencies.
//
// Usage: phext-toc <file.phext>

import { readFile } from 'fs/promises';

const SCROLL_BREAK     = '\x17';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: phext-toc <file.phext>');
    process.exit(1);
  }

  const phext = await readFile(file, 'utf-8');
  // TOC is the first scroll (everything before the first scroll break)
  const firstBreak = phext.indexOf(SCROLL_BREAK);
  const toc = firstBreak === -1 ? phext : phext.slice(0, firstBreak);
  console.log(toc);
}

main().catch(err => { console.error(err); process.exit(1); });
