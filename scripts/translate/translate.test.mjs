/**
 * Self-check for the translation harness: `npm run translate:test`.
 * Covers only the pure parts: the API call is exercised by running the script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, nest, problems, pluralNote, parseArgs } from './translate.mjs';

test('flatten and nest round-trip', () => {
  const nested = { send: { amount: 'Amount', fee: { title: 'Fee' } }, ok: 'OK' };
  const pairs = flatten(nested);
  assert.deepEqual(pairs, [['send.amount', 'Amount'], ['send.fee.title', 'Fee'], ['ok', 'OK']]);
  assert.deepEqual(nest(pairs), nested);
});

test('placeholders must survive, in any position', () => {
  assert.deepEqual(problems('k', 'Between {{min}} and {{max}}', '{{max}} és {{min}} között'), []);
  assert.match(problems('k', 'Enter {{currency}}', 'Add meg az összeget')[0], /placeholders/);
  assert.match(problems('k', 'Enter {{currency}}', 'Add meg {{penz}}')[0], /placeholders/);
});

test('rendered markup must survive', () => {
  assert.deepEqual(problems('k', 'Fee rose to <amount/>.', 'A díj <amount/> összegre emelkedett.'), []);
  assert.match(problems('k', 'Fee rose to <amount/>.', 'A díj emelkedett.')[0], /markup/);
});

test('product names are not translated', () => {
  assert.match(problems('k', 'Open Cash App', 'Nyisd meg a Készpénz Alkalmazást')[0], /Cash App/);
  assert.deepEqual(problems('k', 'Open Cash App', 'Cash App megnyitása'), []);
});

test('a trailing ellipsis means work in progress', () => {
  assert.match(problems('k', 'Sending...', 'Küldés')[0], /ellipsis/);
  assert.deepEqual(problems('k', 'Sending...', 'Küldés...'), []);
});

test('empty and non-string translations are rejected', () => {
  assert.match(problems('k', 'Amount', '  ')[0], /empty/);
  assert.match(problems('k', 'Amount', undefined)[0], /not a string/);
});

test('plural note names the categories the language actually selects', () => {
  // Polish never reaches `other` for a count a reader sees, so it must be told
  // about few and many or every number falls back to English.
  const pl = pluralNote('pl');
  for (const form of ['one', 'few', 'many']) assert.ok(pl.includes(form), `pl missing ${form}`);
  assert.ok(pluralNote('ja').includes('one plural form'), 'ja should be single-form');
  assert.ok(pluralNote('cs').includes('few'), 'cs needs few');
});

test('arguments parse in both spellings', () => {
  assert.deepEqual(parseArgs(['--lang', 'nl,de']).langs, ['nl', 'de']);
  assert.deepEqual(parseArgs(['--lang=nl']).langs, ['nl']);
  assert.equal(parseArgs(['--all']).all, true);
  assert.equal(parseArgs(['--keys=send.']).keys, 'send.');
  assert.throws(() => parseArgs(['--nope']), /unknown flag/);
});
