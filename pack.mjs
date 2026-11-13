#!/usr/bin/env node
// phext-pack: Pack a directory of markdown files into a phext
// Built on libphext: coordinates and serialization are the library's.
//
// Usage: phext-pack <dir> [output.phext]
//
// Each .md file becomes a scroll. Files are sorted alphabetically.
// A table of contents is prepended at 1.1.1/1.1.1/1.1.1.
// Files start at 1.1.1/1.1.1/1.1.2 and increment the scroll coordinate.
// If >100 files, rolls into sections. If >10000, chapters. Etc.

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { Phext, Coordinate } from 'libphext';

const phextLib = new Phext();

const MAX_PER_DIM = 100;

// The display form these tools have always printed: the coordinate's
// collection..scroll tail, with the 1.1.1 library head left implicit.
function coordToString(c) {
  return `${c.y.collection}.${c.y.volume}.${c.y.book}/${c.x.chapter}.${c.x.section}.${c.x.scroll}`;
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
  // Assign coordinates starting at scroll=2 (scroll=1 is TOC).
  // The base-100 rollover is this tool's layout policy; the coordinate
  // objects themselves are libphext's.
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
    const c = new Coordinate();
    c.y.collection = collection; c.y.volume = volume; c.y.book = book;
    c.x.chapter = chapter; c.x.section = section; c.x.scroll = scroll;
    coords.push(c);
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
    tocLines.push(`${coordToString(coords[i])} :: ${files[i].name}`);
  }
  const toc = tocLines.join('\n');

  // Build the phext as a coordinate → scroll map and let libphext
  // serialize it. (implode drops empty scrolls — an empty file packs
  // to no scroll, exactly as an empty scroll carries no content.)
  const scrolls = new Map();
  scrolls.set(new Coordinate().to_string(), toc);
  for (let i = 0; i < files.length; i++) {
    const content = await readFile(files[i].path, 'utf-8');
    scrolls.set(coords[i].to_string(), content);
  }
  const phext = phextLib.implode(scrolls);

  await writeFile(output, phext, 'utf-8');

  const sizeKB = (Buffer.byteLength(phext, 'utf-8') / 1024).toFixed(1);
  console.log(`Packed ${files.length} files → ${output} (${sizeKB} KB)`);
  console.log(`Coordinate range: 1.1.1/1.1.1/1.1.1 to ${coordToString(coords[coords.length - 1])}`);
}

main().catch(err => { console.error(err); process.exit(1); });
