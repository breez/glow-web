# Translations

One directory per language, named by its base subtag (`hu`, `pt`, `bg`). Inside
each, one JSON file per namespace. English is the source: every key exists there
first, and any key missing from another language falls back to it, so a partial
translation renders as a mix rather than as blank space or a raw key.

## The two namespaces

| File | What belongs in it |
|---|---|
| `common.json` | Everything else. Buttons, labels, screen titles, spinners, status headings, failure notices. |
| `critical.json` | Only where a mistranslation could cost someone money or trigger an irreversible action they did not intend. |

The split exists so `critical.json` can be gated on human review, and it is only
worth gating if it stays small. One test decides membership:

> If this sentence were translated wrongly, could someone lose money, or destroy
> something they cannot get back?

Recovery-phrase handling passes: the phrase is the money. So do the wipe and
erase confirmations, the amount and balance warnings, the fee disclosures on a
confirm screen, the rows naming who gets paid, and anything stating whether
funds are safe.

Field labels, spinner text, screen titles, navigation buttons and "something
went wrong" notices all fail it. A mistranslated column heading is an
annoyance; a mistranslated irreversibility warning is a loss. Keeping the second
kind reviewable means not burying it under the first.

## How a language ships

Every language in [`shipping.json`](shipping.json) is served to readers whose
device asks for it. All thirty ship, machine-translated and unreviewed, and
corrections arrive as feedback rather than gating the release. That is a
deliberate reversal of the earlier plan, which held a language back until a
speaker had read its money-path strings.

What that buys: thirty languages at once, and real reports from people using
the app in their own language. What it costs: a mistranslated warning can
reach a reader before anyone catches it, and the money path is where that
matters. The `critical` namespace still exists, so the hundred strings worth
reading first are still separable, and the drafts are regenerable in minutes
once the prompt improves.

Dutch, Portuguese, German and Bulgarian are the four being read internally
first, to tune the prompt before the rest are regenerated.

Arabic and Hebrew are translated but their layout is not mirrored. Right to
left needs logical CSS properties, flipped icons and reversed progress
indicators, which is engineering rather than translation. Until that lands
they read as broken rather than as untranslated.

## Regenerating a translation

The drafts come from a harness, not from hand-editing:

```
npm run translate                      every language, keys it is missing
npm run translate -- --lang nl --all   re-translate Dutch from scratch
npm run translate -- --keys send.      only the send flow
npm run translate -- --dry-run         print the plan and the cost
```

It needs `ANTHROPIC_API_KEY`. The prompt is
[`scripts/translate/prompt.md`](../../scripts/translate/prompt.md) and the
roster is [`languages.json`](../../scripts/translate/languages.json), so
improving a translation is a prompt edit and a re-run. The harness refuses any
string that drops a placeholder, loses rendered markup, translates a product
name or drops a trailing ellipsis, and leaves that chunk untouched rather than
writing it.

## Contributing a translation, without a checkout

You do not need git, an editor, or any of the build tooling. The files here are
plain JSON and GitHub can edit them in the browser.

1. Open the file for your language, for example `hu/common.json`.
2. Click the pencil icon. GitHub makes you your own copy, which is fine.
3. Change the text on the right of each colon. Leave the name on the left alone:
   that is what the app looks the string up by.
4. Click **Commit changes**, then **Propose changes**. That opens a pull
   request, and someone on the team picks it up.

Four rules, and the review is mostly checking them:

- **Only the right-hand side.** `"amount": "Összeg"` is a change. `"osszeg":`
  is a broken build.
- **Keep every `{{placeholder}}` spelled exactly as it is.** You may move it
  anywhere in the sentence, which is the point: put it where your grammar
  wants it. `{{min}} és {{max}} sats között` is right.
- **Keep the quotes and commas.** If GitHub shows a red mark in the margin, a
  quote or comma went missing. Undo and try that line again.
- **Do not translate** Glow, Breez, Spark, Lightning, Bitcoin, LNURL, sats,
  BTC, USD, Face ID, Touch ID.

If you want to translate a language that has no directory yet, say so in an
issue first. Copying `en/` and renaming it is the easy part; deciding to serve
it is the part worth talking about.

A translation tool with a proper editor (Weblate, Crowdin) is worth adding when
the JSON becomes the thing stopping people, not before. Both have free plans
for open-source projects, so the cost of waiting is nothing.

## Glossary

The terms that must be translated consistently, the ones that must never be
translated, and the register to address the reader in all live in
[`scripts/translate/prompt.md`](../../scripts/translate/prompt.md). That file
is what the harness sends, so it is the only copy: a second list here would
drift from the one doing the work.

Two decisions in it are worth knowing without opening it. Glow is never called
a wallet or an account in any language, because the local word for "wallet" is
almost always wrong for what Glow is. And the reader is addressed informally
wherever the language distinguishes it, the way a phone's own interface does.

## Review status

Nothing is gated on this table: every language ships. It records which have
been read by a speaker, so a report can be weighed against whether anyone has
looked.

| Language | read by a speaker |
|---|---|
| `en` English | source |
| `nl` Nederlands | queued, sniff test |
| `pt` Português | queued, sniff test |
| `de` Deutsch | queued, sniff test |
| `bg` Български | queued, sniff test |
| the other twenty-six | no |

## Plural forms

Each language carries the plural categories it actually uses, which is not the
same set English needs. Polish selects `few` and `many` and never `other` for
small counts, so an `_other`-only Polish plural would be English for every
number. Czech and Slovak need `_few`. A test checks this per language against
`Intl.PluralRules` rather than against a hand-maintained list.

## Reading a translation in the app

The language normally comes from the device and cannot be changed in Glow. For
review there is a picker, behind the same developer gesture as the rest of the
diagnostic surfaces:

1. Open **Settings** and tap the version line at the bottom five times.
2. A **Language** section appears above **Passkey**.
3. Pick a language. Unreviewed ones are marked, and the choice survives a
   restart while developer mode stays on.

It lists only languages that have files, so a language nobody has started
cannot be selected and mistaken for a broken translation. Turning developer
mode back off returns the app to the device language on the next launch.

## Where translations break the layout

Measured against English: Italian runs 1.18x longer, German 1.27x, Hungarian
1.18x. Prose absorbs that; short labels in fixed rows do not. Check these
screens on a narrow device before shipping a language:

- **The three buttons under the send input** (paste, scan, contacts). Seventeen
  characters in English, twenty-nine in Hungarian.
- **The wallet header chips** (refund, buy, syncing). All three grow by 8 or
  more characters in German.
- **Transaction status chips** (failed, processing, pending confirmation).
- **Anything reading "..." while busy**: saving, preparing, restoring. German
  turns these into whole clauses (*Wird gespeichert...*).

If a label has no shorter form that is still correct, say so on the pull
request rather than inventing an abbreviation.

## What is deliberately not translated

- **Unilateral exit.** The whole `features/unilateral-exit` tree, plus
  `UnilateralExitPage`. Starting an exit is behind the same five-tap developer
  gesture as the passkey hub, so nobody who cannot read English reaches it, and
  the tracker only appears once an exit exists. It is about ninety strings of
  dense copy about moving funds on-chain, and the feature is still changing
  week to week, so translating it now buys a re-translation later. Revisit when
  the Settings entry loses its `isDevMode` guard: the display path in
  `WalletPage` and `TransactionList` is already ungated and ready for it.
- **Developer-only screens.** The passkey hub (`PasskeySettingsPage` and the
  management, labels and local-state pages under it) is reachable only after a
  five-tap gesture in Settings. Its strings stay hardcoded in English: nobody
  who cannot read them can reach them, and putting roughly sixty diagnostic
  strings in front of volunteers wastes the effort translating the screens
  people actually use.
- **Product and company names.** Glow, Breez, Spark, MoonPay, Cash App,
  Face ID, Touch ID.
- **Currency and protocol names.** Bitcoin, USD, LNURL, Lightning.
- **The credential timestamp label**, which is deliberately English and
  ASCII-only because it is stored on the relying party.
- **Log messages.** They are read by whoever is debugging a report, not by the
  person who filed it, and a log in a language the reader does not speak is
  worse than useless.
- **Errors thrown for developers**, such as the vault's internal failures. Each
  is mapped to a translated message at the call site that shows it.
- **Strings matched against SDK error text.** A couple of branches test whether
  an SDK message contains a phrase; translating the phrase would break the
  match.

## Notes for translators

- **Never concatenate.** If a string reads oddly because a placeholder needs a
  case ending, move the placeholder: `"{{method}} szükséges"` rather than
  forcing "Requires" to come first. Keys exist per sentence so you can reorder
  freely inside one.
- **Placeholders keep their names.** `{{method}}` must survive translation
  spelled exactly that way; only its position may change.
- **Product language.** Glow is not called a wallet or an account, in any
  language. Say Glow, or drop the noun where the sentence still reads. Watch for
  this, because the obvious local word for "wallet" is usually wrong here.
- **Length.** German and Finnish run 30 to 40% longer than English. If a button
  label has no shorter form, say so on the pull request rather than inventing an
  abbreviation.
- **Face ID / Touch ID** are product names and stay untranslated.
