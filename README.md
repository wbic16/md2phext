# phext-pack / md2phext

Pack a directory of files into a phext. Query them by coordinate or keyword.

Zero dependencies. Just Node.

---

## Tools

### `pack.mjs` — File-level packing (any file type)

```bash
# Pack markdown files into a phext
node pack.mjs ./my-docs output.phext

# Include specific file types
node pack.mjs ./my-project output.phext --ext .md,.rs,.toml

# View table of contents
node toc.mjs output.phext

# Fetch a specific scroll by coordinate
node query.mjs output.phext --coord 1.1.1/1.1.1/1.1.5

# Search across all scrolls
node query.mjs output.phext --search "authentication"

# Search with surrounding context (±2 scrolls)
node query.mjs output.phext --context "timing" 2

# Stats
node query.mjs output.phext --stats
```

Each file → one scroll. Scroll coordinates increment per file; section/chapter/book roll over at 100/10k/1M files.

---

### `md2phext.mjs` — Structure-aware markdown packing

```bash
# Convert all .md files in a directory into a structure-aware phext
node md2phext.mjs ./my-docs output

# Output: output.phext + output.manifest.json
```

Each markdown heading level → a different phext dimension:

| Heading | Delimiter | Dimension |
|---------|-----------|-----------|
| H1      | Chapter   | 0x19 (5D) |
| H2      | Section   | 0x18 (4D) |
| H3+     | Scroll    | 0x17 (3D) |
| File    | Book      | 0x1A (6D) |

Produces a `manifest.json` mapping every coordinate to its source file and heading. Cross-references between files (`[text](./other.md#section)`) are extracted as typed edges.

Use `md2phext` when you care about section-level addressing. Use `pack` when you want file-level simplicity.

---

## Why

A phext is a single file that holds an entire document corpus with coordinates. Load it into an LLM context window and every answer comes back with a coordinate you can verify:

> "The authentication timeout is defined at `1.1.1/1.1.1/1.1.7` (Section 4.3.2 of your auth spec)."

The coordinate IS the citation. No embedding database. No vector store. One file, one context window, verifiable references.

**vs. RAG:** RAG retrieves chunks by semantic similarity. It doesn't know dependency graphs — if parameter A is constrained by three documents, RAG may only retrieve one. Phext packs the full corpus with structural coordinates. Cross-document queries traverse the structure, not a probability distribution.

---

## Phext Delimiters

| Delimiter | Hex  | Dimension | Used by          |
|-----------|------|-----------|------------------|
| Scroll    | 0x17 | 3D        | H3+, small files |
| Section   | 0x18 | 4D        | H2               |
| Chapter   | 0x19 | 5D        | H1               |
| Book      | 0x1A | 6D        | File boundary    |
| Volume    | 0x1C | 7D        | (reserved)       |
| Collection| 0x1D | 8D        | (reserved)       |

TOC always lives at scroll 1: `1.1.1/1.1.1/1.1.1`

---

## License

MIT — Phext, Inc.
