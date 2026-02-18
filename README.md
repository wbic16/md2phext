# phext-pack

Pack a directory of files into a phext. Query them by coordinate or keyword.

Zero dependencies. Just Node.

## Usage

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

## What It Does

1. Reads all matching files from a directory (recursively)
2. Sorts them alphabetically
3. Assigns each file a phext coordinate (scroll 1 = table of contents, scroll 2+ = your files)
4. Joins them with phext delimiters (0x17 for scrolls, 0x18+ for higher dimensions)
5. Writes a single `.phext` file

## Why

A phext is a single file that holds an entire document corpus with coordinates. Load it into an LLM context window and every answer comes back with a coordinate you can verify:

> "The authentication timeout is defined at 1.1.1/1.1.1/1.1.7 (Section 4.3.2 of your auth spec)."

The coordinate IS the citation. No embedding database. No vector store. One file, one context window, verifiable references.

## Phext Delimiters

| Delimiter | Hex | Dimension | When Used |
|-----------|-----|-----------|-----------|
| Scroll | 0x17 | 3D | Between files (default) |
| Section | 0x18 | 4D | Every 100 files |
| Chapter | 0x19 | 5D | Every 10,000 files |
| Book | 0x1A | 6D | Every 1,000,000 files |

## License

MIT — Phext, Inc.
