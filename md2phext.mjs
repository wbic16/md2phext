#!/usr/bin/env node
/**
 * md2phext — Convert a directory of markdown files into a single .phext
 *
 * Coordinate scheme:
 *   Each input file   → one BOOK  (0x1A delimiter between files)
 *   H1 sections       → CHAPTER   (0x19)
 *   H2 sections       → SECTION   (0x18)
 *   H3+ / body text   → SCROLL    (0x17)
 *
 * Output:
 *   <output>.phext       — the full phext document
 *   <output>.manifest.json — coordinate → {file, heading, level} index
 *
 * Usage:
 *   node md2phext.js <input-dir> [output-name]
 *   node md2phext.js ./docs standards        → standards.phext + standards.manifest.json
 *   node md2phext.js ./docs                  → out.phext + out.manifest.json
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename, extname } from 'path';

// Phext delimiters
const SCROLL     = '\x17'; // 3D — within a section
const SECTION    = '\x18'; // 4D — H2 boundary
const CHAPTER    = '\x19'; // 5D — H1 boundary
const BOOK       = '\x1A'; // 6D — file boundary
const VOLUME     = '\x1C'; // 7D — future use
const COLLECTION = '\x1D'; // 8D — future use

// Coordinate tracker
class CoordTracker {
  constructor() { this.reset(); }
  reset() {
    this.library = 1; this.shelf = 1; this.series = 1;
    this.collection = 1; this.volume = 1; this.book = 1;
    this.chapter = 1; this.section = 1; this.scroll = 1;
  }
  current() {
    return `${this.library}.${this.shelf}.${this.series}` +
           `/${this.collection}.${this.volume}.${this.book}` +
           `/${this.chapter}.${this.section}.${this.scroll}`;
  }
  nextBook()    { this.book++;    this.chapter = 1; this.section = 1; this.scroll = 1; }
  nextChapter() { this.chapter++; this.section = 1; this.scroll = 1; }
  nextSection() { this.section++; this.scroll = 1; }
  nextScroll()  { this.scroll++; }
}

// Extract cross-references from markdown
function extractLinks(content, sourceFile) {
  const refs = [];
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(content)) !== null) {
    const href = m[2];
    if (!href.startsWith('http')) {
      refs.push({ text: m[1], target: href, source: sourceFile });
    }
  }
  return refs;
}

// Parse a markdown file into segments: [{type, level, heading, body}]
function parseMarkdown(content) {
  const lines = content.split('\n');
  const segments = [];
  let current = { type: 'body', level: 0, heading: null, body: [] };

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) {
      if (current.body.length > 0 || current.heading) {
        segments.push(current);
      }
      current = {
        type: 'heading',
        level: h[1].length,
        heading: h[2].trim(),
        body: []
      };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length > 0 || current.heading) {
    segments.push(current);
  }
  return segments;
}

async function convert(inputDir, outputName) {
  // Collect .md files
  const entries = await readdir(inputDir);
  const mdFiles = entries
    .filter(f => extname(f) === '.md')
    .sort()
    .map(f => join(inputDir, f));

  if (mdFiles.length === 0) {
    console.error(`No .md files found in ${inputDir}`);
    process.exit(1);
  }

  const coord = new CoordTracker();
  const manifest = [];
  const allLinks = [];
  const phextParts = [];

  // Header scroll: index of all files
  const indexLines = [
    '# md2phext Index',
    `Generated: ${new Date().toISOString()}`,
    `Source: ${inputDir}`,
    `Files: ${mdFiles.length}`,
    '',
    '| Coordinate | File | First Heading |',
    '|-----------|------|--------------|',
  ];

  // Reserve book 1 for the index — will fill in after processing
  const indexCoord = coord.current();
  coord.nextBook();
  phextParts.push(''); // placeholder, filled in after

  // Process each file
  for (const filePath of mdFiles) {
    const filename = basename(filePath);
    const fileCoord = coord.current();
    const content = await readFile(filePath, 'utf8');
    const segments = parseMarkdown(content);
    const links = extractLinks(content, filename);
    allLinks.push(...links);

    let fileFirstHeading = null;
    const fileParts = [];

    for (const seg of segments) {
      const text = (seg.heading ? `# ${seg.heading}\n` : '') + seg.body.join('\n');

      if (seg.heading && !fileFirstHeading) fileFirstHeading = seg.heading;

      if (seg.level === 1) {
        // H1 → CHAPTER boundary (except first segment in a file)
        if (fileParts.length > 0) {
          fileParts.push(CHAPTER);
          coord.nextChapter();
        }
      } else if (seg.level === 2) {
        // H2 → SECTION boundary
        if (fileParts.length > 0) {
          fileParts.push(SECTION);
          coord.nextSection();
        }
      } else if (seg.level >= 3) {
        // H3+ → SCROLL boundary
        if (fileParts.length > 0) {
          fileParts.push(SCROLL);
          coord.nextScroll();
        }
      } else {
        // Body text → append to current scroll, no coord advance
        if (fileParts.length > 0) {
          fileParts[fileParts.length - 1] += '\n' + text;
          continue; // don't push new part or record manifest entry
        }
      }

      // Capture coord AFTER advancing
      manifest.push({
        coord: coord.current(),
        file: filename,
        heading: seg.heading,
        level: seg.level,
      });

      fileParts.push(text);
    }

    indexLines.push(`| \`${fileCoord}\` | ${filename} | ${fileFirstHeading || '(none)'} |`);
    phextParts.push(fileParts.join(''));
    coord.nextBook();
  }

  // Cross-reference section
  if (allLinks.length > 0) {
    const xrefCoord = coord.current();
    const xrefLines = [
      '# Cross-References',
      '',
      '| Source File | Link Text | Target |',
      '|------------|----------|--------|',
      ...allLinks.map(l => `| ${l.source} | ${l.text} | ${l.target} |`),
    ];
    phextParts.push(xrefLines.join('\n'));
    indexLines.push(`| \`${xrefCoord}\` | (cross-references) | ${allLinks.length} links |`);
  }

  // Fill in index scroll
  phextParts[0] = indexLines.join('\n');

  // Assemble phext with BOOK delimiters between files
  const phextContent = phextParts.join(BOOK);

  // Write outputs
  const phextPath = `${outputName}.phext`;
  const manifestPath = `${outputName}.manifest.json`;

  await writeFile(phextPath, phextContent, 'utf8');
  await writeFile(manifestPath, JSON.stringify({
    generated: new Date().toISOString(),
    source: inputDir,
    files: mdFiles.map(f => basename(f)),
    coordinates: manifest,
    crossRefs: allLinks,
  }, null, 2), 'utf8');

  console.log(`✓ ${phextPath}  (${phextContent.length} bytes, ${mdFiles.length} files)`);
  console.log(`✓ ${manifestPath}  (${manifest.length} segments indexed)`);

  // Print coordinate summary
  console.log('\nCoordinate map:');
  for (const entry of manifest.filter(e => e.heading)) {
    console.log(`  ${entry.coord}  →  ${entry.file}${entry.heading ? ' # ' + entry.heading : ''}`);
  }
}

// Entry point
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node md2phext.js <input-dir> [output-name]');
  process.exit(1);
}
const inputDir = args[0];
const outputName = args[1] || 'out';

convert(inputDir, outputName).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
