#!/usr/bin/env node
/**
 * Regenerates src/locales/<lang>/*.json from the English bundle.
 *
 * The prompt lives in prompt.md and the roster in languages.json, so tuning a
 * translation is a file edit and a re-run rather than a code change.
 *
 * Usage:
 *   npm run translate                      every language, keys it is missing
 *   npm run translate -- --lang nl,de      only those languages
 *   npm run translate -- --lang nl --all   re-translate everything for nl
 *   npm run translate -- --keys send.      only keys under that prefix
 *   npm run translate -- --dry-run         print the plan and the cost, write nothing
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '..', '..', 'src', 'locales');
const NAMESPACES = ['common', 'critical'];
const MODEL = 'claude-opus-5-5';

/** Keys per request. Small enough that one bad response is cheap to retry,
 *  large enough that the cached English bundle is worth its write. */
const CHUNK = 60;

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
  const opts = { langs: null, keys: null, all: false, dryRun: false, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = () => inline ?? argv[++i];
    if (flag === '--lang') opts.langs = value().split(',').map((s) => s.trim());
    else if (flag === '--keys') opts.keys = value();
    else if (flag === '--all') opts.all = true;
    else if (flag === '--dry-run') opts.dryRun = true;
    else if (flag === '--concurrency') opts.concurrency = Number(value());
    else throw new Error(`unknown flag: ${flag}`);
  }
  return opts;
}

// ------------------------------------------------------------------- bundles

export const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );

export function nest(pairs) {
  const out = {};
  for (const [path, value] of pairs) {
    const parts = path.split('.');
    let cursor = out;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
    cursor[parts.at(-1)] = value;
  }
  return out;
}

const read = (lang, ns) => {
  const path = join(LOCALES, lang, `${ns}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
};

function write(lang, ns, pairs) {
  const dir = join(LOCALES, lang);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ns}.json`), `${JSON.stringify(nest(pairs), null, 2)}\n`);
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** The plural categories a language actually selects for everyday counts.
 *  Polish never reaches `other` below a million, so an `_other`-only Polish
 *  plural would be English for every number a reader sees. */
export function pluralNote(tag) {
  const rules = new Intl.PluralRules(tag);
  const used = [...new Set(Array.from({ length: 200 }, (_, i) => rules.select(i + 1)))];
  if (used.length === 1) {
    return `Your language uses one plural form. Give only the \`_other\` key for each plural, and the same text for \`_one\` if it is present.`;
  }
  return `Your language selects these categories for everyday counts: ${used.join(', ')}. Supply a form for each one you are given, and translate each so it is correct for the numbers that select it.`;
}

// ---------------------------------------------------------------- validation

const placeholders = (s) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((m) => m.replace(/\s/g, '')).sort();
const markup = (s) => (s.match(/<\/?[a-zA-Z]+\/?>/g) ?? []).sort();
const NEVER_TRANSLATED = ['Glow', 'Breez', 'Spark', 'Lightning', 'Bitcoin', 'LNURL', 'Cash App', 'Face ID', 'Touch ID', 'Nostr'];

/** Rejects a translation that would render wrong, so a bad response is retried
 *  rather than written. Everything here is cheaper to catch now than in review. */
export function problems(key, english, translated) {
  const found = [];
  if (typeof translated !== 'string') return [`${key}: not a string`];
  if (!translated.trim()) found.push(`${key}: empty`);
  const [pe, pt] = [placeholders(english), placeholders(translated)];
  if (pe.join() !== pt.join()) found.push(`${key}: placeholders ${pe.join() || 'none'} became ${pt.join() || 'none'}`);
  const [me, mt] = [markup(english), markup(translated)];
  if (me.join() !== mt.join()) found.push(`${key}: markup ${me.join() || 'none'} became ${mt.join() || 'none'}`);
  for (const name of NEVER_TRANSLATED) {
    if (english.includes(name) && !translated.includes(name)) found.push(`${key}: dropped "${name}"`);
  }
  if (english.endsWith('...') && !translated.endsWith('...')) found.push(`${key}: lost the trailing ellipsis`);
  return found;
}

// ------------------------------------------------------------------- the call

function buildSystem(promptTemplate, lang, englishAll) {
  const filled = promptTemplate
    .replaceAll('{{LANGUAGE_NAME}}', lang.name)
    .replaceAll('{{LANGUAGE_ENDONYM}}', lang.endonym)
    .replaceAll('{{PLURAL_NOTE}}', pluralNote(lang.tag));
  // The whole English bundle goes in as context so a key reads in the company
  // of the screen it belongs to. It is identical for every language, so it is
  // the cache prefix and the per-language instructions follow it.
  return [
    {
      type: 'text',
      text: `Here is every string in the app, for context. You will be asked to translate a subset.\n\n${JSON.stringify(englishAll, null, 1)}`,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: filled },
  ];
}

async function translateChunk(client, system, lang, chunk) {
  const schema = z.object(
    Object.fromEntries(chunk.map(([key]) => [key, z.string()])),
  );
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system,
    output_config: { effort: 'medium', format: zodOutputFormat(schema) },
    messages: [
      {
        role: 'user',
        content: `Translate these ${chunk.length} keys into ${lang.name}.\n\n${JSON.stringify(Object.fromEntries(chunk), null, 1)}`,
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error(`refused: ${message.stop_details?.explanation ?? ''}`);
  if (message.stop_reason === 'max_tokens') throw new Error('hit max_tokens: lower CHUNK');
  const parsed = message.parsed_output;
  if (!parsed) throw new Error('no parsable output');
  return { parsed, usage: message.usage };
}

// ----------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const roster = JSON.parse(readFileSync(join(HERE, 'languages.json'), 'utf8')).languages;
  const promptTemplate = readFileSync(join(HERE, 'prompt.md'), 'utf8');

  const targets = opts.langs
    ? roster.filter((l) => opts.langs.includes(l.tag))
    : roster;
  const unknown = (opts.langs ?? []).filter((t) => !roster.some((l) => l.tag === t));
  if (unknown.length) throw new Error(`not in languages.json: ${unknown.join(', ')}`);

  const english = Object.fromEntries(NAMESPACES.map((ns) => [ns, read('en', ns)]));
  const englishFlat = Object.fromEntries(
    NAMESPACES.map((ns) => [ns, flatten(english[ns])]),
  );

  // Work out what each language is missing before spending anything.
  const plan = [];
  for (const lang of targets) {
    for (const ns of NAMESPACES) {
      const have = new Set(flatten(read(lang.tag, ns)).map(([k]) => k));
      const wanted = englishFlat[ns].filter(([key]) => {
        if (opts.keys && !key.startsWith(opts.keys)) return false;
        if (opts.all) return true;
        // A language-specific plural form has no English counterpart, so a key
        // whose base is present counts as done.
        return !have.has(key);
      });
      if (wanted.length) plan.push({ lang, ns, wanted });
    }
  }

  const totalKeys = plan.reduce((n, p) => n + p.wanted.length, 0);
  const chunks = plan.reduce((n, p) => n + Math.ceil(p.wanted.length / CHUNK), 0);
  console.log(`${targets.length} languages, ${totalKeys} keys, ${chunks} requests`);
  for (const lang of targets) {
    const mine = plan.filter((p) => p.lang.tag === lang.tag);
    const n = mine.reduce((a, p) => a + p.wanted.length, 0);
    if (n) console.log(`  ${lang.tag.padEnd(8)} ${String(n).padStart(4)} keys${lang.rtl ? '   (right to left: needs layout work before it ships)' : ''}`);
  }
  if (!totalKeys) return console.log('nothing to do');
  if (opts.dryRun) return console.log('\ndry run, nothing written');

  const client = new Anthropic();
  const totals = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  const failures = [];

  // One language at a time so its cache prefix stays warm across its chunks.
  for (const lang of targets) {
    const mine = plan.filter((p) => p.lang.tag === lang.tag);
    if (!mine.length) continue;
    const system = buildSystem(promptTemplate, lang, english);

    for (const { ns, wanted } of mine) {
      const merged = new Map(flatten(read(lang.tag, ns)));
      for (let i = 0; i < wanted.length; i += CHUNK) {
        const chunk = wanted.slice(i, i + CHUNK);
        const label = `${lang.tag}/${ns} ${i + 1}-${Math.min(i + CHUNK, wanted.length)} of ${wanted.length}`;
        try {
          const { parsed, usage } = await translateChunk(client, system, lang, chunk);
          totals.in += usage.input_tokens ?? 0;
          totals.out += usage.output_tokens ?? 0;
          totals.cacheRead += usage.cache_read_input_tokens ?? 0;
          totals.cacheWrite += usage.cache_creation_input_tokens ?? 0;

          const bad = [];
          for (const [key, source] of chunk) {
            const base = key.replace(PLURAL, '');
            const reference = source ?? Object.fromEntries(englishFlat[ns])[`${base}_other`] ?? '';
            bad.push(...problems(key, reference, parsed[key]));
          }
          if (bad.length) {
            failures.push(`${label}\n    ${bad.join('\n    ')}`);
            console.log(`  ${label}: rejected, ${bad.length} problems`);
            continue;
          }
          for (const [key] of chunk) merged.set(key, parsed[key]);
          console.log(`  ${label}: ok`);
        } catch (e) {
          failures.push(`${label}: ${e.message}`);
          console.log(`  ${label}: ${e.message}`);
        }
      }
      // Written in English's key order, so a diff reads as content and not as
      // a reshuffle. Keys the language carries alone keep their place.
      const ordered = englishFlat[ns]
        .map(([key]) => key)
        .concat([...merged.keys()].filter((k) => !new Set(englishFlat[ns].map(([k2]) => k2)).has(k)));
      write(lang.tag, ns, ordered.filter((k) => merged.has(k)).map((k) => [k, merged.get(k)]));
    }
  }

  // Opus 5.5: $4 per MTok in, $20 out, cache writes 1.25x, cache reads 0.05x.
  const dollars =
    (totals.in * 4 + totals.cacheWrite * 5 + totals.cacheRead * 0.2 + totals.out * 20) / 1e6;
  console.log(
    `\ninput ${totals.in} / cache write ${totals.cacheWrite} / cache read ${totals.cacheRead} / output ${totals.out}`,
  );
  console.log(`about $${dollars.toFixed(2)}`);

  if (failures.length) {
    console.error(`\n${failures.length} chunks were rejected and left untouched:\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

// Importable for the self-check beside this file, so `node --test` on this
// directory does not run the whole job.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
