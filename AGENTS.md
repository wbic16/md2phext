# AGENTS.md — phext-pack

Zero-dependency tool for packing files into phexts and querying them.

## Rules
- Zero dependencies. Node stdlib only.
- Phext delimiters are the real ones (0x17-0x1F, 0x01). No substitutes.
- Coordinates use the canonical format: `library.shelf.series/collection.volume.book/chapter.section.scroll`
- TOC always lives at scroll 1 (1.1.1/1.1.1/1.1.1)
