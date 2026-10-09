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
        ('15-fee-nothing-worth', 'Dead end', 'new', 'Nothing can be recovered',
         'Here the ₿350 would cost more in fees than it holds. Glow does not show the reason.'),
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
    ('should', 'Can the SDK record a payment for a recovery or a unilateral exit?',
     'The proposal had one payment per co-signed recovery, but the SDK records none now, and none for a finished unilateral exit either. Once miners confirm a recovery, the SDK drops its funds from recoverable_funds_sats. The user then sees them nowhere in the history, except in a record the app keeps on that one device. Glow keeps the same kind of record for each unilateral exit.',
     'Record one payment per co-signed recovery, and one per unilateral exit once miners confirm its sweep, with the leaf IDs and destination in the details. Say whether the SDK restores these payments on a reinstall or a second device. If the SDK records neither, confirm that the app should keep its own records, which a restored device will not have.',
     [('#1173 crates/breez-sdk/core/src/models/mod.rs:196-203', 'PaymentMethod has no recovery or unilateral exit method'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:391-444', 'PaymentDetails has no recovery or unilateral exit variant'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:262-287', "the SDK has the operators co-sign, then stores the transaction in the leaf's row; no payment"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:420-434, 766-795', "the SDK stores each leaf's sweep, with its txid and block height, once it is in a block; no payment"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:296-304', 'the SDK reads the rows only inside the crate; no SDK call returns them'),
      ('#1173 crates/breez-sdk/core/src/realtime_sync/storage.rs:639-640', 'the SDK does not replicate the rows to other devices'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:176', 'the SDK does not keep the response')]),
    ('should', 'Should the SDK count funds it can never recover?',
     'The SDK lists some leaves as NotRecoverable in a quote, such as a leaf the watchtower moved on-chain without paying anything to its key. It keeps counting them in a sync. In a sync it now also counts, without a chain check, a leaf too small to send at the lowest relay fee rate. Glow then keeps showing a Recoverable Funds row for funds the user cannot recover.',
     'Leave NotRecoverable leaves, and leaves too small to send at any fee rate, out of the total, or report them separately.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:812-817', 'the SDK marks a leaf NotRecoverable when the watchtower paid nothing to its key'),
      ('#1173 crates/breez-sdk/core/src/sdk/unilateral_exit.rs:613-632', "the SDK marks a leaf NotRecoverable when it cannot continue the leaf's unilateral exit from what is on-chain"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:740-764', 'the SDK counts every stored leaf with no spend or sweep stored, except one with a stored output it has not finished checking'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:700-705, 717-738, 1003-1009', 'in a sync the SDK stores a recovered leaf below 393 sats, or one swept after a unilateral exit at 58 sats or less, without a chain check'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:15-17', 'per the docs, the SDK keeps such leaves in the total'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:203', 'per the docs, the operators cannot co-sign a recovery for some leaves')]),
    ('should', 'Can the SDK mark a quoted leaf whose recovery is already signed?',
     'Under RecoverableOnly and All, the SDK still quotes a leaf whose co-signed recovery is in the mempool, without saying so. The SDK then requires the new recovery to pay a higher fee than that one, even when another device sent it, and otherwise fails with ReplacementFeeTooLow.',
     'Mark such a leaf on the quote, with the fee rate a replacement has to beat. The app can then offer a fee bump or say the funds are on their way.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:580-583, 605-609, 667-682', 'the SDK leaves a leaf out of the quote only once it counts as recovered'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:311-325', 'the SDK counts a leaf as recovered only for a spend in a block, found now or stored'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:374-393', 'on every quote the SDK reads the spend of each output it looks up, one in the mempool included, and does not pass it on'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3264-3271', 'RecoverFundsLeaf has only leaf_id, value_sats and method'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:237-252, 673-720', 'the SDK requires a different recovery to outbid the one on the network, else ReplacementFeeTooLow'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3851-3862, 3868-3905', 'on a re-quote the SDK returns the kept transaction, and refuses a lower rate, or another address at the same rate')]),
    ('should', 'Can stranded funds become unrecoverable if the user waits?',
     "Once a stranded leaf's branch is on-chain, a previous owner's refund can become valid after enough blocks pass. Glow cannot tell the user when this can happen, because the SDK reports no such block height.",
     "If this window exists, expose the block height at which a previous owner's refund becomes valid for each affected leaf, so the user knows when they need to act.",
     [('#1173 crates/spark/src/core/constants.rs:10', 'TIME_LOCK_INTERVAL = 100'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3264-3271', 'RecoverFundsLeaf has no deadline'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:198-206', "per the docs, the operators can send their own version of each transaction; nothing on a previous owner's refund")]),
    ('nice', "Can the SDK update the total on the wallet's other devices?",
     'The SDK records a confirmed co-signed recovery only in prepare_recover_funds, recover_funds and check_recover_funds, and only on the device that made the call. In a sync it reads the chain only for a leaf it has not stored yet. The one exception is a leaf whose stored output it has yet to check for a spend. So on another device where it stored the leaf earlier, the SDK keeps the funds in recoverable_funds_sats until the user enters an address and gets an empty quote.',
     "Accept prepare_recover_funds without a destination, so the app can update the total before the user enters an address. Or replicate the recorded recovery to the wallet's other devices through real-time sync.",
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:38-41', 'in prepare_recover_funds the SDK records a recovery or sweep it finds in a block'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:224-235, 386-436', 'in check_recover_funds the SDK records a recovery in a block'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:684-699', 'in a sync the SDK skips every leaf with a stored row, except one with a stored output and no check time'),
      ('#1173 crates/breez-sdk/core/src/realtime_sync/storage.rs:639-640', 'the SDK keeps the rows on the device that wrote them'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:47', 'prepare_recover_funds requires a valid destination address'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3913-3919', 'after the block and a sync, the SDK still counts the leaf'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/sync.rs (roeierez, Oct 2)', 'chain reads only in the recovery calls and the initial sync; a stale total on another device is acceptable'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/sync.rs (JssDWt, Oct 2)', 'real-time sync of the chain facts is an option, hard to make reorg-safe')]),
    ('nice', 'Should the SDK announce a recovery already in the mempool on a restored device?',
     'On a restored device, the SDK announces a recovery still in the mempool with RecoverableFunds. It keeps the funds in the total until it sees the recovery confirmed in a recovery call. Glow then offers to recover funds already on their way.',
     'Treat a recovery in the mempool as on its way: no event, and out of the total unless it drops out.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:700-707', 'in a sync the SDK checks a new recovered leaf with the chain service'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:77-88, 580-595', 'for a spend in the mempool, the SDK stores the output with no spend and counts the check as complete'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:376-383', 'the SDK emits RecoverableFunds when a sync stores a new leaf with funds left'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:694-698', 'in later syncs the SDK skips the stored leaf, whose check is complete'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3863-3866, 3933-3939', 'on a restored device the SDK emits RecoverableFunds for a recovery that has not confirmed, and not for one that has')]),
    ('nice', 'Should a co-signed recovery below the dust limit be skipped?',
     'The SDK still has the operators co-sign a recovery whose payout is above zero but below the dust limit, and returns it Ready, but nodes do not relay it. Glow then cannot broadcast it, and the SDK keeps the funds in the total. The SDK now has a dust check, but runs it only in a sync.',
     'Skip such a leaf as FeeExceedsValue, as described in the 35ff78a86 commit message, or flag it on the quote.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:266-268, 320-324', 'the SDK builds a recovery unless the payout is zero'),
      ('#1173 crates/spark-wallet/src/watchtower_exit.rs:282-293', 'in its dust check the SDK treats a payout below the dust limit as none'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:701-702, 720-731', 'the SDK runs that check only in a sync, to skip the chain check of a small leaf'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:59-66', 'the SDK skips a leaf as FeeExceedsValue only when it cannot build a recovery'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3252-3254', "FeeExceedsValue is about a fee of at least the leaf's value"),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:99', 'per the docs, the SDK builds a dust recovery and nodes do not relay it'),
      ('#1173 commit 35ff78a86', 'per its message, FeeExceedsValue also covers a payout below the dust limit')]),
    ('nice', 'Can the SDK list a leaf it finds already recovered in recover_funds?',
     "The SDK reads the output's spend on every quote, unless it already recorded the leaf's recovery, and leaves out a leaf whose recovery is in a block. If miners confirm the recovery after the quote, the SDK still drops the leaf from both leaves and failed in recover_funds. The user can then review an amount and get a receipt without it.",
     'List such a leaf as already recovered in the response, so the app can explain the smaller amount on the receipt.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:580-583, 605-609, 667-682', 'for the quote, the SDK looks up each leaf with no recorded recovery or sweep, and leaves out a recovered one'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:215-236', 'in the build, the SDK finds a spend in a block, stores it and returns nothing'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:479-482', 'the SDK only logs it at debug'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3949-3955', 'for an older quote, the SDK returns empty leaves, transactions and failed')]),
    ('nice', 'Should the SDK report Redo for a recovery on an output that cannot confirm?',
     "Until miners confirm one of a leaf's direct transactions, the SDK can have the operators co-sign a recovery on an output that never confirms. In a quote, the SDK now does not store an output in a block when it could not finish checking that output's spend. If the chain service then fails a request in recover_funds, the SDK can build the recovery on the held direct transaction's output, although miners confirmed another direct transaction. In check_recover_funds, the SDK still reports it Ready and Valid.",
     'Return Redo when the output a co-signed recovery spends can no longer confirm, so the app rebuilds on the right one.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:155-164', "the SDK assumes the held direct transaction's output when no direct transaction above is in a block, or when the lookup of the ancestor's spend failed"),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:467-474', 'the SDK prefers a stored output, else uses the assumed one and stores nothing'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:77-88, 461-465', 'in a quote the SDK stores the output only once the check of its spend is complete'),
      ('#1173 crates/breez-sdk/core/src/persist/mod.rs:182-185', "the SDK's storage removes the recoveries and spend when it replaces the stored output with one at another txid or vout"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:848-862', 'in check_recover_funds the SDK reads unspent or in the mempool as Ready, and keeps the status without a result'),
      ('#1173 crates/breez-sdk/core/src/sdk/chain_queries.rs:174', 'the SDK takes an outpoint the chain service does not know as unspent'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:241-249', 'the SDK returns Redo only from the unilateral check')]),
    ('nice', 'Should the docs say the recovery is version 3?',
     "The SDK now builds the co-signed recovery as version 3, as the operators' own SDK does. Until miners confirm it, nodes relay a transaction spending its output only if that one is also version 3 and small. So the receiving wallet cannot spend the funds or fee-bump the recovery with an ordinary transaction, while the docs still call the recovery an ordinary transaction.",
     'Say in the docs that the recovery is version 3, and what that means for the receiving wallet until miners confirm it.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:301-303', "the SDK builds the recovery as version 3, the version the operators' own SDK uses"),
      ('#1173 commit 48f8fc6d9', 'per the removed comment, the SDK used version 2 so the recipient could bump the fee with an ordinary child'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:30', 'per the docs, only the unilateral CPFP children are version 3'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:216', 'per the docs, the app broadcasts a cooperative recovery alone, as an ordinary transaction')]),
    ('nice', 'Should the SDK fail all of recover_funds over one leaf?',
     "While no direct transaction above a leaf is in a block, the SDK quotes it on an assumed output and does not store that output. It now also leaves an output in a block unstored when it could not finish checking that output's spend. If the SDK then cannot look the output up in recover_funds, it fails the whole call with InvalidInput, unilateral leaves included. Per the docs, InvalidInput means a quote made by another wallet, not a failed request to the operators or the chain service.",
     'List such a leaf in failed and build the rest.',
     [('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:439-450, 474', 'the SDK stores only an output in a block, and quotes an assumed one without storing it'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:77-88, 461-465', 'in a quote the SDK stores the output only once the check of its spend is complete'),
      ('#1173 commit 20bc87318', 'per its message, the SDK stores an output in prepare_recover_funds only with a completed check'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:161-171, 398-412', 'when the operators fail the ancestors fetch, the SDK takes the lookup as Pending'),
      ('#1173 crates/spark-wallet/src/watchtower_exit.rs:154-160, 169-173, 202, 219', 'when the chain service fails some of the requests a lookup needs, the SDK takes the lookup as Pending'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:139-144, 537-552', 'the SDK looks the leaves up first, and fails the call for a leaf with neither a found nor a stored output'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:312', 'per the docs, the error means a quote made by another wallet'),
      ('#1173 35ff78a86 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:262-268, 593-617', 'the SDK used to store assumed outputs and fall back on the stored one'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/recover_funds.rs (danielgranhao, Oct 8)', 'raises the same gap, and asks the SDK to list such a leaf in failed instead of failing the whole call')]),
    ('nice', 'Should the SDK recheck a recovery until it is a few blocks deep?',
     'The SDK now records a co-signed recovery or a sweep at its first confirmation and never undoes the record. If miners reorganize that block away and never include the transaction again, the SDK keeps the leaf out of the total on that device. For a co-signed recovery, the SDK also keeps the leaf out of every quote, and now does not even look the leaf up. Only an app that kept the response can still find and resend that recovery.',
     "Check a recorded recovery or sweep again until it is a few blocks deep, as the SDK did before at 6. Skip a recorded leaf's lookup only after that.",
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:224-235, 406-432', 'in check_recover_funds the SDK records a spend or sweep at its first confirmation'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:311-324', 'the SDK counts the leaf as recovered from a stored spend, whatever the chain now shows'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:667-671, 750-757', 'the SDK leaves a leaf with a stored spend or sweep out of the total'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:684-699', 'in a sync the SDK checks a stored leaf again only while its check is incomplete'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:580-597, 667-682', 'in a quote the SDK does not look up a leaf with a stored spend or sweep, nor quote a unilateral exit after a stored spend'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/recover_funds.rs (roeierez, Oct 8)', 'asks to filter out recovered leaves before the lookup, so the SDK stops querying them; done in 036b24827'),
      ('#1173 35ff78a86 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:1040-1054', 'the SDK used to undo a confirmed recovery until it settled'),
      ('#1173 35ff78a86 crates/breez-sdk/core/src/persist/mod.rs:1157-1166', 'settled at 6 blocks'),
      ('#1173 commit 3de13c9a6', 'its message still says the SDK puts the value back after a reorg')]),
    ('nice', 'Should the SDK build on funding UTXOs it could not follow?',
     'Once the chain service fails one request in recover_funds, the SDK cannot follow the funding UTXOs and builds on them as passed in, even if miners confirmed a spend. Nodes refuse the transactions that spend those UTXOs, and the SDK returns no error. In check_recover_funds, the SDK can still report such a transaction Ready. Glow passes back the same UTXOs, as the docs allow, when it rebuilds a unilateral exit after the watchtower moves a leaf.',
     'When the SDK cannot follow a funding UTXO, return an error, or mark the transactions that spend it Unverified. A reviewer suggests the SDK keep the stop for sync only. That makes this rarer, but the SDK still reaches this case when the request for a funding UTXO itself fails.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:139-165', 'the SDK looks up the co-signed leaves, then builds the unilateral exit with the same chain queries'),
      ('#1173 crates/breez-sdk/core/src/sdk/chain_queries.rs:28-30, 83-107', 'once the chain service fails a request, the SDK sends it no other request in that call'),
      ('#1173 crates/breez-sdk/core/src/sdk/unilateral_exit.rs:219-222', 'the SDK follows the funding UTXOs with those queries before it plans'),
      ('#1173 crates/spark-wallet/src/unilateral_exit.rs:340-342, 360-367', 'the SDK keeps a funding UTXO as passed in unless it read a confirmed spend of it'),
      ('#1173 crates/spark-wallet/src/unilateral_exit.rs:505-530', "in the check, the SDK reads each transaction's first input and its anchor, not the funding of its CPFP child"),
      ('#1173 crates/spark-wallet/src/unilateral_exit.rs:826-828, 870-880', 'the SDK marks a branch Unverified only from its chain read while quoting'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:251', 'per the docs, the app can pass back the same UTXOs and the SDK follows them'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:323', 'per the docs, Unverified also means the SDK could not tell whether its funding is already spent'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/chain_queries.rs (danielgranhao, Oct 8)', 'a reviewer asks to keep the stop for sync only')]),
]

SEVERITY_LABELS = {'blocking': 'Blocking', 'should': 'Should have', 'nice': 'Nice to have'}

# API names in the notes' prose, drawn as code.
IDENTIFIERS = [
    'recoverable_funds_sats', 'prepare_recover_funds', 'check_recover_funds', 'recover_funds', 'get_info', 'RecoverFundsLeaf',
    'RecoverableOnly', 'RecoverableFunds', 'NotRecoverable', 'FeeExceedsValue', 'ReplacementFeeTooLow',
    'PaymentMethod', 'PaymentDetails', 'InvalidInput', 'TIME_LOCK_INTERVAL', 'leaf_id', 'value_sats', 'Specific', 'Cooperative',
    'All', 'Redo', 'Ready', 'Valid', 'Unverified',
]
ID_RE = re.compile(r'(?<![\w-])(' + '|'.join(IDENTIFIERS) + r')(?![\w-])')
SENTENCE = re.compile(r'(?<=[.?!])\s+(?=[A-Z])')


def fmt(text):
    out = html.escape(text, quote=False)
    out = out.replace('"need at least N sats"', '<code>need at least N sats</code>')
    out = out.replace('both leaves and failed', 'both <code>leaves</code> and <code>failed</code>')
    out = out.replace('in failed and', 'in <code>failed</code> and')
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
