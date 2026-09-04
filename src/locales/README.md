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

A language is translatable as soon as it has a directory here. It is **served to
readers** only once its base subtag appears in `SHIPPING_LANGUAGES` in
[`../services/i18n.ts`](../services/i18n.ts).

Add it there when both hold:

1. `critical.json` is complete **and** has been read by a person who speaks the
   language. Not reviewed by whoever generated it.
2. Overall completion is high enough that the screen does not read as broken.

Until then, a reader whose device asks for that language gets English. This is
deliberate: volunteer translation does not arrive finished, and a half-translated
send screen is worse than an English one.

## Review status

| Language | `critical` reviewed | Notes |
|---|---|---|
| `en` | source | |
| `hu` | **no** | First draft, machine-generated. Needs a native speaker before `hu` joins `SHIPPING_LANGUAGES`. |

## What is deliberately not translated

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
