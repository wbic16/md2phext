# AGENTS.md — md2phext

Tools for packing files into phexts and reasoning about them with coordinate-cited answers.

## Files
- `pack.mjs` — Pack a directory of files into a .phext
- `toc.mjs` — Print the table of contents from a .phext
- `query.mjs` — Extract by coordinate or search by keyword
- `reason.mjs` — Ask questions via OpenClaw gateway, get coordinate-cited answers
- `weaver.html` — Browser-based drag-and-drop tool (no server required)

## Rules
- Zero extra dependencies in pack/toc/query. `reason.mjs` requires `ws` (WebSocket client).
- Phext delimiters are the real ones (0x17-0x1F). No substitutes.
- Coordinates use the canonical format: `library.shelf.series/collection.volume.book/chapter.section.scroll`
- TOC always lives at scroll 1 (1.1.1/1.1.1/1.1.1)
- `reason.mjs` expects OPENCLAW_TOKEN env var; OPENCLAW_URL is optional (default: ws://127.0.0.1:18789)

## Coordinate Scheme
Files are packed sequentially: scroll increments first (up to 100), then section, chapter, book.
TOC = 1.1.1/1.1.1/1.1.1. First file = 1.1.1/1.1.1/1.1.2. 101st file = 1.1.1/1.1.2/1.1.1.
