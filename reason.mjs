#!/usr/bin/env node
// phext-reason: Load a phext corpus and ask questions via OpenClaw gateway
// Zero extra dependencies. Uses Node WebSocket via gateway protocol.
//
// Usage:
//   phext-reason <file.phext> "your question here"
//   phext-reason <file.phext> --interactive
//
// Requires a running OpenClaw gateway:
//   openclaw gateway start
//   export OPENCLAW_TOKEN=$(openclaw config get gateway.token)
//   export OPENCLAW_URL=ws://127.0.0.1:18789   # optional, default shown

import { readFile } from 'fs/promises';
import { createInterface } from 'readline';
import { WebSocket } from 'ws';

const GATEWAY_URL   = process.env.OPENCLAW_URL   || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || '';

// ─── Gateway Client ─────────────────────────────────────────────────────────
class Gateway {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.pending = {};
    this.counter = 0;
    this.onEvent = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        const id = this._id();
        this.pending[id] = { resolve, reject };
        this._send({ type: 'req', id, method: 'connect', params: { token: this.token } });
      });

      this.ws.on('message', raw => {
        try {
          const frame = JSON.parse(raw);
          if (frame.type === 'res' && this.pending[frame.id]) {
            const { resolve, reject } = this.pending[frame.id];
            delete this.pending[frame.id];
            frame.ok ? resolve(frame.payload) : reject(new Error(frame.error?.message || 'Request failed'));
          } else if (frame.type === 'event' && this.onEvent) {
            this.onEvent(frame);
          }
        } catch {}
      });

      this.ws.on('error', reject);
    });
  }

  _id() { return `r-${Date.now()}-${++this.counter}`; }
  _send(obj) { this.ws.send(JSON.stringify(obj)); }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._id();
      const timer = setTimeout(() => {
        delete this.pending[id];
        reject(new Error(`Timeout: ${method}`));
      }, 60_000);
      this.pending[id] = {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      };
      this._send({ type: 'req', id, method, params: params || {} });
    });
  }

  async ask(phext, question) {
    const systemPrompt = buildSystemPrompt(phext);
    const fullMessage = `${systemPrompt}\n\n[QUESTION]\n${question}`;
    const key = `reason-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      let answer = '';

      this.onEvent = frame => {
        const p = frame.payload || {};
        const delta = p.delta || p.text || '';
        const done = p.done || frame.event === 'message';

        if (frame.event === 'message.delta' || frame.event === 'message') {
          if (p.role === 'assistant' || !p.role) {
            if (delta) {
              process.stdout.write(delta);
              answer += delta;
            }
            if (done) {
              process.stdout.write('\n');
              this.onEvent = null;
              resolve(answer);
            }
          }
        }
      };

      this.request('send', {
        sessionKey: 'main',
        text: fullMessage,
        idempotencyKey: key
      }).catch(reject);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ─── Phext Helpers ─────────────────────────────────────────────────────────
const SCROLL_BREAK = '\x17';

function splitScrolls(phext) {
  // Split and track coordinates
  const scrolls = [];
  let coord = { scroll: 1, section: 1, chapter: 1, book: 1, volume: 1, collection: 1 };
  const MAX = 100;

  const parts = phext.split(/[\x17\x18\x19\x1A\x1C\x1D]/);
  // We only split on scroll breaks for coordinate purposes here
  const rawScrolls = phext.split(SCROLL_BREAK);
  rawScrolls.forEach((content, i) => {
    scrolls.push({ coord: `1.1.1/1.1.1/1.1.${i + 1}`, content });
  });
  return scrolls;
}

function buildSystemPrompt(phext) {
  const scrolls = splitScrolls(phext);
  const toc = scrolls[0]?.content || '';

  return `You are a reasoning assistant for a phext document corpus.

CORPUS TABLE OF CONTENTS:
${toc}

FULL CORPUS:
${phext}

INSTRUCTIONS:
- When answering questions, cite the exact phext coordinate for every factual claim.
- Format citations as [coord] inline, e.g. [1.1.1/1.1.1/1.1.3]
- Quote the relevant passage briefly after the citation.
- If the answer is not in the corpus, say so clearly. Do not hallucinate.
- The coordinate IS the citation — it allows the reader to verify your answer directly.`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage:
  phext-reason <file.phext> "your question"
  phext-reason <file.phext> --interactive

Environment:
  OPENCLAW_URL    Gateway WebSocket URL (default: ws://127.0.0.1:18789)
  OPENCLAW_TOKEN  Gateway token (openclaw config get gateway.token)

Examples:
  # Pack your docs first
  node pack.mjs ./my-docs corpus.phext

  # Ask a single question
  OPENCLAW_TOKEN=abc123 node reason.mjs corpus.phext "What does section 3.4 say about timeouts?"

  # Interactive session
  OPENCLAW_TOKEN=abc123 node reason.mjs corpus.phext --interactive`);
    process.exit(0);
  }

  const phextFile = args[0];
  const question = args[1];
  const interactive = args[1] === '--interactive';

  if (!GATEWAY_TOKEN) {
    console.error('Error: OPENCLAW_TOKEN not set.');
    console.error('Run: export OPENCLAW_TOKEN=$(openclaw config get gateway.token)');
    process.exit(1);
  }

  let phext;
  try {
    phext = await readFile(phextFile, 'utf-8');
  } catch (err) {
    console.error(`Cannot read ${phextFile}: ${err.message}`);
    process.exit(1);
  }

  const scrolls = splitScrolls(phext);
  const chars = Buffer.byteLength(phext, 'utf-8');
  console.error(`Loaded: ${phextFile} — ${scrolls.length} scrolls, ${(chars/1024).toFixed(1)} KB`);

  const gw = new Gateway(GATEWAY_URL, GATEWAY_TOKEN);
  try {
    await gw.connect();
    console.error(`Connected to gateway at ${GATEWAY_URL}\n`);
  } catch (err) {
    console.error(`Cannot connect to gateway: ${err.message}`);
    console.error('Make sure OpenClaw gateway is running: openclaw gateway start');
    process.exit(1);
  }

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('Interactive mode. Ctrl+C to exit.\n');

    const ask = () => {
      rl.question('> ', async q => {
        if (q.trim()) {
          await gw.ask(phext, q.trim());
          console.log('');
        }
        ask();
      });
    };
    ask();

    rl.on('close', () => { gw.close(); process.exit(0); });
  } else {
    if (!question) {
      console.error('Provide a question or use --interactive');
      gw.close();
      process.exit(1);
    }
    await gw.ask(phext, question);
    gw.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
