import html
import os
import re
import shutil
import tempfile

# THROWAWAY: builds the review page from the shots shoot.mjs writes.
# SHOTS_DIR holds <id>.png; OUT_DIR gets index.html plus shots/.
HERE = os.path.dirname(os.path.abspath(__file__))
SP = os.environ.get('SHOTS_DIR', os.path.join(tempfile.gettempdir(), 'glow-recover-mock'))
OUT = os.environ.get('OUT_DIR', os.path.join(tempfile.gettempdir(), 'glow-recover-review'))

# A shot: (id, step, tag, title, caption). Empty title or caption renders nothing.
# A scenario: (heading, intro paragraphs, shots[, anchor]). A case: (eyebrow, heading, intro, blocks).

EXIT_CASE = [
    ('Recoverable funds that result from a unilateral exit', [
        'If the unilateral exit stalls, the watchtower can move some of its leaves on-chain.',
        'The unilateral exit takes them back in itself, with no separate row, flow or payments.',
    ], [
        ('ux-13a-tracker-after-update', 'Running', 'today', '', ''),
        ('ux-13b2-wallet-update-needed', 'Wallet', 'today', '', ''),
        ('ux-13b-update-needed', 'Paused', 'today', 'Update needed',
         'The update recovers the moved funds as part of the unilateral exit. It usually runs by itself.'),
        ('ux-13c-wallet-landed', 'Wallet', 'today', '',
         'One BTC Transfer for the whole unilateral exit, the moved funds included.'),
        ('ux-13d-archived-details', 'Landed', 'today', '', ''),
    ]),
]

KINDS = '''<div class="kinds">
      <p>Recoverable funds come in two kinds, and each is recovered differently:</p>
      <ul>
        <li><a href="#cosigned"><b>Funds the operators co-sign.</b></a> The watchtower already moved them on-chain. The operators co-sign one transaction per output, paid from the funds: no exit fee, no waiting.</li>
        <li><a href="#exitfee"><b>Funds that need an exit fee.</b></a> They are stranded and go out through a unilateral exit, which requires an exit fee to be funded from another wallet and may take days of waiting to complete.</li>
      </ul>
    </div>'''

NORMAL_CASE = [
    ('Letting users know they have recoverable funds', ['The same notice for both kinds of funds: those the operators co-sign, and those that need an exit fee.'], [
        ('01-wallet-row', 'Wallet', 'new', 'Grouped under "Recovery"',
         'Once the user has started a unilateral exit, it shows under "Unilateral Exit" instead.'),
    ]),
    KINDS,
    ('Funds the operators co-sign', [], [
        ('02-destination', 'Address', 'new', '', ''),
        ('03-fee-cosigned', 'Fee', 'new', '', ''),
        ('04-review-cosigned', 'Review', 'new', '', ''),
        ('04b-review-left-out', 'Review', 'new', '', 'Glow shows how much stays behind, not why.'),
        ('05-sent', 'Done', 'new', '', ''),
        ('06-wallet-after-cosigned', 'Wallet', 'new', 'One BTC Transfer per recovery',
         'Glow keeps this row itself, **because the SDK records no payment for a co-signed recovery.**'),
    ], 'cosigned'),
    ('Funds that need an exit fee', ['Leaves stranded by another leaf\'s unilateral exit or an old state.'], [
        ('07-review-stranded', 'Review', 'new', '', ''),
        ('08-pending-owed', 'Pay', 'today', '', ''),
        ('09-pending-funded', 'Start', 'today', '', ''),
        ('10-tracker-stranded', 'Running', 'today', '', ''),
        ('11-archived-dialog', 'Landed', 'today', '', ''),
    ], 'exitfee'),
    ('When no exit fee is needed', [
        'If the funds are already on-chain and only the last transaction is left, its fee comes out of those funds.',
        'There is no exit fee to send, so Glow starts the recovery at once.',
    ], [
        ('07b-review-no-exit-fee', 'Review', 'new', '', ''),
        ('07c-running-no-exit-fee', 'Running', 'today', '', ''),
    ]),
    ('Both at once', [
        'When a parent goes on-chain, some of its funds may only need operator signatures while others need an exit fee.',
        'Sync finds both, and the Recoverable Funds row shows them as one total.',
    ], [
        ('12-review-mixed', 'Review', 'new', 'Split in one line',
         'One tap sends the co-signed part now. The rest waits for the exit fee.'),
        ('13-wallet-after-split', 'Wallet', 'new', 'Co-signed part sent, the rest waits for the exit fee',
         'The co-signed part as one BTC Transfer, the rest as today\'s "Waiting for exit fee" row.'),
    ]),
    ('When something goes wrong', [
        'Show a message when the user has an actionable recovery step, such as starting Recover Funds or completing a Unilateral Exit.',
        'Do not show a message when recovery is already in progress or requires no action from the user.',
    ], [
        ('14-review-error', 'Error', 'new', 'Nothing was co-signed',
         'If the operators sign only some of the funds, no error is shown. The unsigned funds stay in the Recoverable Funds row.'),
        ('15-fee-nothing-worth', 'Dead end', 'new', 'Worth less than the fee',
         'The SDK leaves out funds (₿350 here) that cost more to move than they hold. With nothing left to recover, Glow does not say why.'),
    ]),
    ('Speeding up a stuck recovery', [
        'Replace-by-fee: the operators co-sign a new transaction for the same output at a higher fee, which replaces the stuck one.',
        'It\'s rarely needed, so the option sits in the recovery\'s tracker, under Advanced.',
    ], [
        ('17-tracker-bump', 'Tracker', 'new', 'Under Advanced',
         'Only while the recovery is unconfirmed.'),
        ('18-bump-fee', 'Fee', 'new', 'Above the current rate',
         'Every speed pays more than the recovery already on the network.'),
        ('19-bump-review', 'Review', 'new', 'Same address',
         'Glow keeps the address. Continue Recovery replaces the stuck transaction.'),
    ]),
]

CASES = [
    ('With a unilateral exit', '', '', EXIT_CASE),
    ('Without a unilateral exit', '', '', NORMAL_CASE),
]

# (severity, title, why, ask, [(ref, what it shows)]). A why or ask may end in '- ' bullet lines.
NOTES = [
    ('should', 'Can a co-signed recovery record a payment again?',
     'The proposal had one payment per co-signed recovery, but none is recorded now. Once a recovery confirms, its funds leave recoverable_funds_sats and show nowhere in the history, except in a record the app keeps on that one device.',
     'Record one payment per co-signed recovery, with its leaf ID and destination in the details. If not, confirm that the app should keep its own record, which a restored device will not have.',
     [('#1173 crates/breez-sdk/core/src/models/mod.rs:196-203', 'PaymentMethod has no recovery method'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:391-444', 'PaymentDetails has no recovery variant'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:418-444', 'co-sign, then store the transaction on the leaf\'s record; no payment'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:176', 'the SDK does not keep the response')]),
    ('should', 'Should sync notice when a co-signed recovery confirms?',
     'Only check_recover_funds, or a later build, records that a co-signed recovery confirmed, and only on the device that runs it. On a second or restored device, the funds stay in recoverable_funds_sats.',
     'Let sync record a recovery once it confirms, at least for leaves with a recovery it signed or saw in the mempool. If sync stays off the chain, say which call a device without the kept response should make.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:205-211, 346-374', 'check_recover_funds reads each co-signed transaction and records a confirmed one'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:388-403', 'a build that finds the recovery confirmed records it too'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:59-60, 83-86', 'sync counts a leaf from its stored record and never reads the chain for it'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3913-3919', 'after the block, a sync still keeps the total'),
      ('#1173 crates/breez-sdk/core/src/sdk/sync.rs:226', 'review thread: chain reads only in the recovery calls and the initial sync'),
      ('#1173 commit 40d94e4', 'its message still describes rereading the recovery each block')]),
    ('should', 'Can funds no recovery can move leave recoverable_funds_sats?',
     'The quote lists some leaves as NotRecoverable, such as a moved leaf whose watchtower transaction pays nothing to its key. Sync keeps counting them, so the Recoverable Funds row never clears.',
     'Leave NotRecoverable leaves out of the total, or report them separately.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:590-598', 'a moved leaf no co-signed recovery reaches is NotRecoverable'),
      ('#1173 crates/breez-sdk/core/src/sdk/unilateral_exit.rs:625-633', 'an exit stopped by a transaction the wallet cannot continue from is NotRecoverable'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:59-62, 83-86', 'sync counts a watchtower-exited leaf until a recovery is recorded'),
      ('#1173 crates/breez-sdk/core/src/sdk/unilateral_exit.rs:426-428', 'sync counts an exiting leaf until a sweep is recorded'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:203', 'docs: some leaves stay out of reach')]),
    ('should', 'Can a quote mark a leaf whose recovery is already signed?',
     'RecoverableOnly and All still quote a leaf whose co-signed recovery is in the mempool, without saying so. A new recovery must then outbid it or fails with ReplacementFeeTooLow, even when another device sent it.',
     'Mark such a leaf on the quote, with the fee rate a replacement has to beat, so the app can offer a fee bump or say the funds are on their way.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:547-550', 'quoted while no recovery has confirmed'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3260-3266', 'RecoverFundsLeaf is leaf_id, value_sats and method only'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:404-411, 544-560', 'a different recovery must outbid the one on the network, else ReplacementFeeTooLow'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3851-3862, 3868-3905', 'a re-quote returns the kept transaction; a lower rate, or another address at the same rate, is refused')]),
    ('should', 'Can stranded funds become unrecoverable if the user waits?',
     'Once a stranded leaf\'s branch is on-chain, a previous owner\'s refund can become valid after enough blocks pass. The recovery row gives the user no indication of when this can happen.',
     'If this window exists, expose the block height at which a previous owner\'s refund becomes valid for each affected leaf, so the user knows when they need to act.',
     [('#1173 crates/spark/src/core/constants.rs:10', 'TIME_LOCK_INTERVAL = 100'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3260-3266', 'no deadline on RecoverFundsLeaf'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:198-206', 'the new warning covers the operators\' version of each step, not a previous owner\'s refund')]),
    ('nice', 'Should a restored device announce a recovery already in the mempool?',
     'A restored device announces a recovery still in the mempool with RecoverableFunds, and keeps it in the total until it runs its own check. Glow then offers to recover funds already on their way.',
     'Treat a recovery in the mempool as on its way: no event, and out of the total unless it drops out.',
     [('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:176-195', 'a spend still in the mempool is stored as not recovered'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:337-343', 'emitted when a sync finds new leaves'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3863-3866, 3933-3939', 'a restored device reports an unconfirmed recovery, and not a confirmed one')]),
    ('nice', 'Should a co-signed recovery below the dust limit be skipped?',
     'A co-signed leaf whose payout is below the dust limit is still co-signed and returned Ready, but nodes will not relay it. Glow\'s broadcast then fails and the funds stay in the total.',
     'Skip it as FeeExceedsValue, as the 2380cd1 commit message says, or flag it on the quote.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:243-245, 271-275', 'built unless the payout is zero'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3249-3251', 'FeeExceedsValue covers only a fee of at least the leaf\'s value'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:99', 'docs: built, and not relayed'),
      ('#1173 commit 2380cd1', 'its message says FeeExceedsValue also covers a payout below the dust limit')]),
    ('nice', 'Can recover_funds report a leaf it finds already recovered?',
     'The quote trusts the stored record. If recover_funds then finds the recovery confirmed, it drops the leaf from both leaves and failed, so the user can review an amount and get a receipt without it.',
     'Check the output\'s spend when quoting, or list such a leaf as already recovered in the response.',
     [('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:388-403', 'the build finds a confirmed spend and returns nothing'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:422-425', 'only logged at debug'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3949-3955', 'an older quote comes back with empty leaves, transactions and failed')]),
    ('nice', 'Should a recovery on an output that cannot confirm read as Redo?',
     'Before the chain shows which direct transaction confirmed, a recovery can be co-signed on an output that never confirms. check_recover_funds still reports it Ready and Valid.',
     'Return Redo when the output a co-signed recovery spends can no longer confirm, so the app rebuilds on the right one.',
     [('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:323-333, 477-482', 'an assumed output stands in when the chain shows no confirmed direct transaction'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:593-620', 'an output found later replaces it and clears the stored recoveries'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:208-225, 615-645', 'unspent or unreadable reads Ready; Redo comes only from the unilateral check')]),
]

SEVERITY_LABELS = {'blocking': 'Blocking', 'should': 'Should have', 'nice': 'Nice to have'}

# API names in the notes' prose, drawn as code.
IDENTIFIERS = [
    'recoverable_funds_sats', 'check_recover_funds', 'recover_funds', 'get_info', 'RecoverFundsLeaf',
    'RecoverableOnly', 'RecoverableFunds', 'NotRecoverable', 'FeeExceedsValue', 'ReplacementFeeTooLow',
    'PaymentMethod', 'PaymentDetails', 'TIME_LOCK_INTERVAL', 'leaf_id', 'value_sats', 'Specific', 'Cooperative',
    'All', 'Redo', 'Ready', 'Valid',
]
ID_RE = re.compile(r'(?<![\w-])(' + '|'.join(IDENTIFIERS) + r')(?![\w-])')
SENTENCE = re.compile(r'(?<=[.?!])\s+(?=[A-Z])')


def fmt(text):
    out = html.escape(text, quote=False)
    out = out.replace('"need at least N sats"', '<code>need at least N sats</code>')
    out = out.replace('both leaves and failed', 'both <code>leaves</code> and <code>failed</code>')
    out = out.replace('TIME_LOCK_INTERVAL = 100', 'TIME_LOCK_INTERVAL_EQ')
    out = ID_RE.sub(r'<code>\1</code>', out)
    return out.replace('TIME_LOCK_INTERVAL_EQ', '<code>TIME_LOCK_INTERVAL = 100</code>')


def bold(text):
    return re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html.escape(text))


def lines(text, render):
    """Each sentence on its own line."""
    parts = [render(part) for part in SENTENCE.split(text) if part]
    if len(parts) == 1:
        return parts[0]
    return '<span class="lines">' + ''.join(f'<span>{part}</span>' for part in parts) + '</span>'


def rich(text):
    """A lead line, then any '- ' lines as a bullet list."""
    rows = text.split('\n')
    lead = lines(rows[0], fmt)
    bullets = [fmt(row[2:]) for row in rows[1:] if row.startswith('- ')]
    return lead + (f'<ul>{"".join(f"<li>{b}</li>" for b in bullets)}</ul>' if bullets else '')


def figure(shot_id, step, tag, title, caption):
    tag_html = '<span class="tag">New</span>' if tag == 'new' else '<span class="tag today">As today</span>'
    alt = f'{step}: {title}' if title else step
    title_html = f'<b>{html.escape(title)}</b>' if title else ''
    caption_html = f'<span>{lines(caption, bold)}</span>' if caption else ''
    return f'''<figure>
      <button type="button" class="shot" aria-label="Enlarge: {html.escape(alt)}"><img src="shots/{shot_id}.png" alt="{html.escape(alt)}" width="402" height="874"></button>
      <figcaption><span class="step">{html.escape(step)}{tag_html}</span>{title_html}{caption_html}</figcaption>
    </figure>'''


def scenario(block):
    if isinstance(block, str):
        return block
    name, intro, shots, *anchor = block
    anchor_html = f' id="{anchor[0]}"' if anchor else ''
    intro_html = ''.join(f'<p>{html.escape(p)}</p>' for p in intro)
    figs = '\n'.join(figure(*s) for s in shots)
    return f'''<div class="scenario"{anchor_html}>
    <div class="scenario-head"><h3>{html.escape(name)}</h3>{intro_html}</div>
    <div class="strip">
    {figs}
    </div>
  </div>'''


def storyboard():
    parts = []
    for i, (eyebrow, title, intro, blocks) in enumerate(CASES, 1):
        title_html = f'<h2 id="case{i}">{html.escape(title)}</h2>' if title else ''
        intro_html = f'<p>{html.escape(intro)}</p>' if intro else ''
        body = '\n'.join(scenario(b) for b in blocks)
        parts.append(f'''<section aria-label="{html.escape(title or eyebrow)}">
    <div class="section-head">
      <span class="eyebrow">{html.escape(eyebrow)}</span>
      {title_html}{intro_html}
    </div>
    {body}
  </section>''')
    return '\n'.join(parts)


def notes():
    out = []
    for i, (severity, title, why, ask, evidence) in enumerate(NOTES, 1):
        refs = '\n'.join(f'<li><code>{html.escape(ref)}</code><span>{fmt(what)}</span></li>' for ref, what in evidence)
        out.append(f'''<article class="note" id="n{i}">
  <div class="note-head"><span class="note-num">N{i}</span><span class="chip chip-{severity}">{SEVERITY_LABELS[severity]}</span></div>
  <h3>{fmt(title)}</h3>
  <div class="row"><b>Why</b><div>{rich(why)}</div></div>
  <div class="row"><b>Ask</b><div>{rich(ask)}</div></div>
  <details><summary>Evidence</summary><ul class="refs-list">{refs}</ul></details>
</article>''')
    return '\n'.join(out)


def shot_ids():
    for case in CASES:
        for block in case[3]:
            if not isinstance(block, str):
                for s in block[2]:
                    yield s[0]


def main():
    shots_dir = os.path.join(OUT, 'shots')
    if os.path.isdir(shots_dir):
        shutil.rmtree(shots_dir)
    os.makedirs(shots_dir)
    missing = []
    for shot_id in shot_ids():
        src = os.path.join(SP, 'shots', f'{shot_id}.png') if os.path.isdir(os.path.join(SP, 'shots')) else os.path.join(SP, f'{shot_id}.png')
        if os.path.exists(src):
            shutil.copy(src, os.path.join(shots_dir, f'{shot_id}.png'))
        else:
            missing.append(shot_id)
    page = open(os.path.join(HERE, 'page-template.html')).read()
    page = page.replace('__STORYBOARD__', storyboard()).replace('__NOTES__', notes())
    open(os.path.join(OUT, 'index.html'), 'w').write(page)
    print('ok', len(page), len(os.listdir(shots_dir)), 'shots', 'missing:', missing)


main()
