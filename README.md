# md2phext

Pack a directory of markdown (or any text) files into a phext corpus. Query by coordinate, keyword, or context window. Two implementations: Node.js (zero deps) and Rust.

## The Problem

You have a pile of documents — standards specs, design notes, exported PDFs. You want to ask an LLM questions across all of them with **verifiable citations** — not hallucinated summaries, but answers linked to the exact source file and section.

A phext packs your whole corpus into one file. Each document gets a coordinate. The LLM answers with coordinates. The coordinate IS the citation.

## Node.js (Zero Dependencies)

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

## Rust CLI

```bash
cargo install --path .

# Build phext from directory
phext-drop build ./docs/ --output corpus.phext --manifest

# Dump as LLM-ready context
phext-drop context corpus.phext | llm "What timing constraints apply to Phase 2 TDMA?"

# Show coordinate manifest
phext-drop map corpus.phext
```

## TIA-102 / LMR Use Case (Tooker Workflow)

```bash
# Convert your purchased PDFs to text
for f in TIA-102*.pdf; do pdftotext "$f" "${f%.pdf}.md"; done

# Pack into phext
node pack.mjs ./tia-102/ tia-102.phext

# Query with citations
node query.mjs tia-102.phext --context "IMBE vocoder timing" 2
```

The model reads your actual purchased documents — not its training data, which does not contain the full TIA-102 suite.

## How It Works

1. Reads all matching files from a directory (recursively, sorted)
2. Assigns each file a phext coordinate (`1.1.1/1.1.1/1.1.N`)
3. Embeds a coordinate header in each scroll so the LLM always knows its location
4. Joins them with phext scroll delimiters (`\x17`)
5. Scroll 0 = manifest/table of contents

## Phext Delimiters

| Delimiter | Hex  | Dimension | Fires when |
|-----------|------|-----------|------------|
| Scroll    | 0x17 | 3D        | Every file (default) |
| Section   | 0x18 | 4D        | Every 100 files |
| Chapter   | 0x19 | 5D        | Every 10,000 files |
| Book      | 0x1A | 6D        | Every 1,000,000 files |

## `phext-reason` — Ask questions, get cited answers

Requires a running [OpenClaw](https://openclaw.ai) gateway.

```bash
npm install  # installs ws dependency for WebSocket support

export OPENCLAW_TOKEN=$(openclaw config get gateway.token)

# Single question
node reason.mjs corpus.phext "What does BAAB say about IMBE superframe structure?"

# Interactive session
node reason.mjs corpus.phext --interactive
```

Answers include coordinate citations you can verify:

```
The IMBE superframe structure is defined at [1.1.1/1.1.1/1.1.7]:
"A superframe consists of 18 voice frames at 20ms each..."
```

Run `node query.mjs corpus.phext --coord 1.1.1/1.1.1/1.1.7` to confirm.

## `weaver.html` — Browser Tool (No Install)

Open `weaver.html` directly in any browser. No server, no build step.

- Drag-and-drop `.md` files
- Builds phext corpus in memory, shows coordinate map
- Connect to local OpenClaw gateway (URL + token)
- Ask questions, get coordinate-cited answers, click to verify

## License

MIT — Phext, Inc.
