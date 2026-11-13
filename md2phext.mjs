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
 *   node md2phext.js --chain <name> <dir1> <dir2> [dir3 ...]
 *                                            → one multiverse stream: each dir a universe,
 *                                              joined by 0x02, closed by 0x03 (libphext 0.6)
 *
 * Phext coordinates and serialization come from libphext (the phext
 * library) — this tool lays markdown structure out at coordinates and
 * lets the library serialize. The only phext bytes handled locally are
 * the chain framing bytes (0x02 / 0x03): libphext-node predates chains,
 * so chain composition lives here until the JS library reaches parity
 * with libphext-rs 0.6.
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename, extname } from 'path';
import { Phext, Coordinate } from 'libphext';

const phextLib = new Phext();

// Chain framing (libphext-rs 0.6): separates / terminates whole phexts
// (universes) within one stream. See the header note.
const CHAIN_BREAK = '\x02'; // stream level — separates universes within a chain
const CHAIN_CLOSE = '\x03'; // stream level — terminates a chain

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

async function packDir(inputDir) {
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

  // The pack is a coordinate → scroll map, serialized by libphext's
  // implode() at the end. Coordinate advance is the library's too.
  const coord = new Coordinate();
  const scrolls = new Map();
  const manifest = [];
  const allLinks = [];

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

  // Reserve book 1 for the index — filled in after processing
  const indexCoord = coord.to_string();
  coord.book_break();

  // Process each file
  for (const filePath of mdFiles) {
    const filename = basename(filePath);
    const fileCoord = coord.to_string();
    const content = await readFile(filePath, 'utf8');
    const segments = parseMarkdown(content);
    const links = extractLinks(content, filename);
    allLinks.push(...links);

    let fileFirstHeading = null;
    let segmentsInFile = 0;
    let lastKey = null;

    for (const seg of segments) {
      const text = (seg.heading ? `# ${seg.heading}\n` : '') + seg.body.join('\n');

      if (seg.heading && !fileFirstHeading) fileFirstHeading = seg.heading;

      if (seg.level === 1) {
        // H1 → CHAPTER boundary (except first segment in a file)
        if (segmentsInFile > 0) coord.chapter_break();
      } else if (seg.level === 2) {
        // H2 → SECTION boundary
        if (segmentsInFile > 0) coord.section_break();
      } else if (seg.level >= 3) {
        // H3+ → SCROLL boundary
        if (segmentsInFile > 0) coord.scroll_break();
      } else {
        // Body text → append to current scroll, no coord advance
        if (segmentsInFile > 0) {
          scrolls.set(lastKey, scrolls.get(lastKey) + '\n' + text);
          continue; // don't record a manifest entry
        }
      }

      // Capture coord AFTER advancing
      const key = coord.to_string();
      manifest.push({
        coord: key,
        file: filename,
        heading: seg.heading,
        level: seg.level,
      });

      scrolls.set(key, text);
      lastKey = key;
      segmentsInFile++;
    }

    indexLines.push(`| \`${fileCoord}\` | ${filename} | ${fileFirstHeading || '(none)'} |`);
    coord.book_break();
  }

  // Cross-reference section
  if (allLinks.length > 0) {
    const xrefCoord = coord.to_string();
    const xrefLines = [
      '# Cross-References',
      '',
      '| Source File | Link Text | Target |',
      '|------------|----------|--------|',
      ...allLinks.map(l => `| ${l.source} | ${l.text} | ${l.target} |`),
    ];
    scrolls.set(xrefCoord, xrefLines.join('\n'));
    indexLines.push(`| \`${xrefCoord}\` | (cross-references) | ${allLinks.length} links |`);
  }

  // Fill in index scroll
  scrolls.set(indexCoord, indexLines.join('\n'));

  // Serialize with libphext. Note: implode drops empty scrolls (an
  // empty scroll carries no content) — coordinates of every non-empty
  // scroll are exactly the ones recorded in the manifest.
  const phextContent = phextLib.implode(scrolls);

  return {
    phextContent,
    manifestData: {
      generated: new Date().toISOString(),
      source: inputDir,
      files: mdFiles.map(f => basename(f)),
      coordinates: manifest,
      crossRefs: allLinks,
    },
    fileCount: mdFiles.length,
    segmentCount: manifest.length,
    manifest,
  };
}

async function convert(inputDir, outputName) {
  const pack = await packDir(inputDir);

  // Write outputs
  const phextPath = `${outputName}.phext`;
  const manifestPath = `${outputName}.manifest.json`;

  await writeFile(phextPath, pack.phextContent, 'utf8');
  await writeFile(manifestPath, JSON.stringify(pack.manifestData, null, 2), 'utf8');

  console.log(`✓ ${phextPath}  (${pack.phextContent.length} bytes, ${pack.fileCount} files)`);
  console.log(`✓ ${manifestPath}  (${pack.segmentCount} segments indexed)`);

  // Print coordinate summary
  console.log('\nCoordinate map:');
  for (const entry of pack.manifest.filter(e => e.heading)) {
    console.log(`  ${entry.coord}  →  ${entry.file}${entry.heading ? ' # ' + entry.heading : ''}`);
  }
}

// Chain mode (libphext 0.6): pack several directories as ONE multiverse stream —
// each directory becomes a universe, joined by CHAIN_BREAK (0x02) and terminated
// by CHAIN_CLOSE (0x03). Address a universe's scrolls as $N:<coordinate>.
async function convertChain(inputDirs, outputName) {
  const packs = [];
  for (const dir of inputDirs) {
    packs.push(await packDir(dir));
  }
  const stream = packs.map(p => p.phextContent).join(CHAIN_BREAK) + CHAIN_CLOSE;
  const phextPath = `${outputName}.phext`;
  const manifestPath = `${outputName}.manifest.json`;
  await writeFile(phextPath, stream, 'utf8');
  await writeFile(manifestPath, JSON.stringify({
    generated: new Date().toISOString(),
    chain: true,
    universes: packs.map((p, i) => ({ universe: i + 1, ...p.manifestData })),
  }, null, 2), 'utf8');
  console.log(`✓ ${phextPath}  (${stream.length} bytes, ${packs.length} universes)`);
  console.log(`✓ ${manifestPath}  (${packs.reduce((n, p) => n + p.segmentCount, 0)} segments indexed)`);
  packs.forEach((p, i) => {
    console.log(`  $${i + 1} ← ${p.manifestData.source} (${p.fileCount} files)`);
  });
}

// Entry point
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node md2phext.js <input-dir> [output-name]');
  process.exit(1);
}
if (args[0] === '--chain') {
  const outputName = args[1];
  const inputDirs = args.slice(2);
  if (!outputName || inputDirs.length < 2) {
    console.error('Usage: node md2phext.js --chain <output-name> <dir1> <dir2> [dir3 ...]');
    process.exit(1);
  }
  convertChain(inputDirs, outputName).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
} else {
  const inputDir = args[0];
  const outputName = args[1] || 'out';

  convert(inputDir, outputName).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
