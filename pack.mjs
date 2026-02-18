#!/usr/bin/env node
// phext-pack: Pack a directory of markdown files into a phext
// Zero dependencies. Uses raw phext delimiters.
//
// Usage: phext-pack <dir> [output.phext]
//
// Each .md file becomes a scroll. Files are sorted alphabetically.
// A table of contents is prepended at 1.1.1/1.1.1/1.1.1.
// Files start at 1.1.1/1.1.1/1.1.2 and increment the scroll coordinate.
// If >100 files, rolls into sections. If >10000, chapters. Etc.

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';

const SCROLL_BREAK    = '\x17'; // 3D - between scrolls
const SECTION_BREAK   = '\x18'; // 4D
const CHAPTER_BREAK   = '\x19'; // 5D
const BOOK_BREAK      = '\x1A'; // 6D
const VOLUME_BREAK    = '\x1C'; // 7D
const COLLECTION_BREAK = '\x1D'; // 8D

const MAX_PER_DIM = 100;

function coordToString(scroll, section, chapter, book, volume, collection) {
  return `${collection}.${volume}.${book}/${chapter}.${section}.${scroll}`;
}

function delimiterForLevel(level) {
  switch (level) {
    case 0: return SCROLL_BREAK;
    case 1: return SECTION_BREAK;
    case 2: return CHAPTER_BREAK;
    case 3: return BOOK_BREAK;
    case 4: return VOLUME_BREAK;
    case 5: return COLLECTION_BREAK;
    default: return SCROLL_BREAK;
  }
}

async function collectFiles(dir, extensions = ['.md', '.txt', '.rs', '.toml', '.json']) {
  const entries = await readdir(dir, { recursive: true });
  const files = [];
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (extensions.includes(ext)) {
      const fullPath = join(dir, entry);
      const s = await stat(fullPath);
      if (s.isFile()) {
        files.push({ path: fullPath, name: entry });
      }
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function assignCoordinates(count) {
  // Assign coordinates starting at scroll=2 (scroll=1 is TOC)
  const coords = [];
  for (let i = 0; i < count; i++) {
    const idx = i + 1; // 1-indexed, +1 because scroll 1 is TOC
    let remaining = idx;
    const scroll = (remaining % MAX_PER_DIM) + 1;
    remaining = Math.floor(remaining / MAX_PER_DIM);
    const section = (remaining % MAX_PER_DIM) + 1;
    remaining = Math.floor(remaining / MAX_PER_DIM);
    const chapter = (remaining % MAX_PER_DIM) + 1;
    remaining = Math.floor(remaining / MAX_PER_DIM);
    const book = (remaining % MAX_PER_DIM) + 1;
    remaining = Math.floor(remaining / MAX_PER_DIM);
    const volume = (remaining % MAX_PER_DIM) + 1;
    remaining = Math.floor(remaining / MAX_PER_DIM);
    const collection = (remaining % MAX_PER_DIM) + 1;
    coords.push({ scroll, section, chapter, book, volume, collection });
  }
  return coords;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: phext-pack <directory> [output.phext]');
    console.error('');
    console.error('Options:');
    console.error('  --ext .md,.txt,.rs   File extensions to include (default: .md,.txt,.rs,.toml,.json)');
    process.exit(1);
  }

  const dir = args[0];
  const output = args[1] || 'output.phext';

  let extensions = ['.md', '.txt', '.rs', '.toml', '.json'];
  const extIdx = args.indexOf('--ext');
  if (extIdx !== -1 && args[extIdx + 1]) {
    extensions = args[extIdx + 1].split(',').map(e => e.startsWith('.') ? e : '.' + e);
  }

  const files = await collectFiles(dir, extensions);
  if (files.length === 0) {
    console.error(`No files found in ${dir} with extensions: ${extensions.join(', ')}`);
    process.exit(1);
  }

  const coords = assignCoordinates(files.length);

  // Build TOC
  const tocLines = [`# Table of Contents`, `# Packed from: ${dir}`, `# Files: ${files.length}`, ``];
  for (let i = 0; i < files.length; i++) {
    const c = coords[i];
    const coordStr = coordToString(c.scroll, c.section, c.chapter, c.book, c.volume, c.collection);
    tocLines.push(`${coordStr} :: ${files[i].name}`);
  }
  const toc = tocLines.join('\n');

  // Build phext: TOC at scroll 1, then each file at its coordinate
  let phext = toc;

  let prevCoord = { scroll: 1, section: 1, chapter: 1, book: 1, volume: 1, collection: 1 };
  for (let i = 0; i < files.length; i++) {
    const c = coords[i];
    const content = await readFile(files[i].path, 'utf-8');

    // Determine which delimiter to emit
    if (c.collection !== prevCoord.collection) {
      phext += COLLECTION_BREAK;
    } else if (c.volume !== prevCoord.volume) {
      phext += VOLUME_BREAK;
    } else if (c.book !== prevCoord.book) {
      phext += BOOK_BREAK;
    } else if (c.chapter !== prevCoord.chapter) {
      phext += CHAPTER_BREAK;
    } else if (c.section !== prevCoord.section) {
      phext += SECTION_BREAK;
    } else {
      phext += SCROLL_BREAK;
    }

    phext += content;
    prevCoord = c;
  }

  await writeFile(output, phext, 'utf-8');

  const sizeKB = (Buffer.byteLength(phext, 'utf-8') / 1024).toFixed(1);
  console.log(`Packed ${files.length} files → ${output} (${sizeKB} KB)`);
  console.log(`Coordinate range: 1.1.1/1.1.1/1.1.1 to ${coordToString(
    coords[coords.length-1].scroll, coords[coords.length-1].section,
    coords[coords.length-1].chapter, coords[coords.length-1].book,
    coords[coords.length-1].volume, coords[coords.length-1].collection
  )}`);
}

main().catch(err => { console.error(err); process.exit(1); });
