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
        ('ux-13b-update-needed', 'Paused', 'new', 'Update needed',
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
        'The SDK finds both in a sync, and Glow shows them as one total in the Recoverable Funds row.',
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
        'Glow doesn\'t have this yet.',
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
     'The user sees recovered funds and finished unilateral exits nowhere in the payment history, except in a record Glow keeps on that one device. On a restored or second device, the user sees neither.',
     'Record one payment per co-signed recovery and one per unilateral exit, and restore them on a reinstall or a second device. If not, confirm that the app should keep its own records.',
     [('#1173 crates/breez-sdk/core/src/models/mod.rs:198-205', 'PaymentMethod has no recovery or unilateral exit method'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:393-446', 'PaymentDetails has no recovery or unilateral exit variant'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:290-314', "the SDK has the operators co-sign, then stores the transaction in the leaf's row; no payment"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:478-492, 1003-1032', "the SDK stores each leaf's sweep, with its txid and block height, once it is in a block; no payment"),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:1680-1682', 'per its doc comment, the SDK takes the funds out of the total at the next sync after it has seen their recovery in a block'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:346-354', 'the SDK reads the rows only inside the crate; no SDK call returns them'),
      ('#1173 crates/breez-sdk/core/src/realtime_sync/storage.rs:639-640', 'the SDK does not replicate the rows to other devices'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:176', 'the SDK does not keep the response')]),
    ('should', 'Should the SDK count funds it can never recover?',
     'Glow keeps showing a Recoverable Funds row for funds the user can never recover. The SDK counts leaves no recovery can move (NotRecoverable) and leaves too small to send at the lowest relay fee rate.',
     'Leave those leaves out of recoverable_funds_sats, or report them separately.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:1049-1054', 'the SDK marks a leaf NotRecoverable when the watchtower paid nothing to its key'),
      ('#1173 crates/breez-sdk/core/src/sdk/unilateral_exit.rs:612-631', "the SDK marks a leaf NotRecoverable when it cannot continue the leaf's unilateral exit from what is on-chain"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:980-1001', "the SDK counts every leaf it lists until it stores the leaf's recovery or sweep in a block"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:940-945, 957-978, 1244-1250', 'in a sync the SDK stores a recovered leaf below 393 sats, or a leaf of 58 sats or less after its unilateral exit, without a chain check'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:15-17', 'per the docs, the SDK keeps such leaves in the total'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:203', 'per the docs, the operators cannot co-sign a recovery for some leaves')]),
    ('should', 'Can the SDK mark a leaf whose recovery is already on its way?',
     'The SDK still includes a leaf in the quote when its co-signed recovery is already in the mempool, for example one another device sent. The user then gets a ReplacementFeeTooLow error instead of learning the funds are on their way.',
     'Mark such a leaf on the quote, with the fee rate a replacement has to beat.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:657-662, 687-691, 907-922', 'the SDK leaves a leaf out of the quote only once it counts as recovered'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:347-360', 'the SDK counts a leaf as recovered only for a spend in a block, found now or stored'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:437-460, 704-716', 'in prepare_recover_funds the SDK reads the spend of the output of each leaf with a co-signed recovery, one in the mempool included, and does not pass it on'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3284-3291', 'RecoverFundsLeaf has only leaf_id, value_sats and method'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:260-275, 943-990', 'the SDK requires a different recovery to outbid the one on the network, else ReplacementFeeTooLow'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:344-346, 420-428', 'in recover_funds the SDK also takes a recovery it stored as proof of a co-sign, so it reads the spend even before its next refresh of the leaf'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3851-3862, 3868-3905', 'when the test prepares again, the SDK returns the kept transaction, and refuses a lower rate, or another address at the same rate')]),
    ('should', 'Can stranded funds become unrecoverable if the user waits?',
     "Once a stranded leaf's branch is on-chain, a previous owner's refund may become valid after enough blocks. Glow cannot warn the user in time, because the SDK reports no such block height.",
     'If this window exists, expose that block height for each affected leaf.',
     [('#1173 crates/spark/src/core/constants.rs:10', 'TIME_LOCK_INTERVAL = 100'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3284-3291', 'RecoverFundsLeaf has no deadline'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:198-206', "per the docs, the operators can send their own version of each transaction; nothing on a previous owner's refund")]),
    ('nice', "Can the SDK update the total on the wallet's other devices?",
     'The SDK records a confirmed co-signed recovery in prepare_recover_funds, recover_funds and check_recover_funds, and only on the device that made the call. In a sync it reads the chain only for a leaf it has not stored yet. The one exception is a leaf whose stored output it has yet to check for a spend. So on another device where it stored the leaf earlier, the SDK keeps the funds in recoverable_funds_sats until the user enters an address and gets an empty quote.',
     "Accept prepare_recover_funds without a destination, so the app can update the total before the user enters an address. Or replicate the recorded recovery to the wallet's other devices through real-time sync.",
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:45-48', 'in prepare_recover_funds the SDK records a recovery or sweep it finds in a block'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:245-264, 444-494', 'in check_recover_funds the SDK records a recovery in a block'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:924-939', 'in a sync the SDK skips every leaf with a stored row, except one with a stored output and no check time'),
      ('#1173 crates/breez-sdk/core/src/realtime_sync/storage.rs:639-640', 'the SDK keeps the rows on the device that wrote them'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:54', 'in prepare_recover_funds the SDK requires a valid destination address'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3913-3919', 'after the block and a sync, the SDK still counts the leaf'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:196', 'per the docs, the SDK on another device keeps the funds in the total until it finds the recovery there'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/sync.rs (roeierez, Oct 2)', 'chain reads only in the recovery calls and the initial sync; a stale total on another device is acceptable'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/sync.rs (JssDWt, Oct 2)', 'real-time sync of the chain facts is an option, hard to make reorg-safe'),
      ('#1173 review thread on crates/breez-sdk/core/src/models/mod.rs (danielgranhao, Oct 9)', 'a reviewer asks to document that the SDK on another device keeps these funds in the total; done in bb7bce923')]),
    ('nice', 'Should the SDK announce a recovery already in the mempool on a restored device?',
     'On a restored device, the SDK announces a recovery still in the mempool with RecoverableFunds. It keeps the funds in the total until it sees the recovery confirmed in a recovery call. Glow then offers to recover funds already on their way.',
     'Treat a recovery in the mempool as on its way: no event, and out of the total unless it drops out.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:396-400, 940-946', 'in a sync the SDK checks a new recovered leaf with the chain service'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:105-116, 850-865', 'for a spend in the mempool, the SDK stores the output with no spend and counts the check as complete'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:434-441, 990-998', 'the SDK emits RecoverableFunds when a sync stores a new leaf with funds left'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:924-928, 934-938', 'in later syncs the SDK skips the stored leaf, whose check is complete'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3863-3866, 3933-3939', 'on a restored device the SDK emits RecoverableFunds for a recovery that has not confirmed, and not for one that has')]),
    ('nice', 'Should a co-signed recovery below the dust limit be skipped?',
     'The SDK still has the operators co-sign a recovery whose payout is above zero but below the dust limit, and returns it Ready, but nodes do not relay it. Glow then cannot broadcast it, and the SDK keeps the funds in the total. The SDK now has a dust check, but runs it only in a sync.',
     'Skip such a leaf as FeeExceedsValue, as described in the 1ae66aa60 commit message, or flag it on the quote.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:336-338, 391-394', 'the SDK builds a recovery unless the payout is zero'),
      ('#1173 crates/spark-wallet/src/watchtower_exit.rs:352-363', 'in its dust check the SDK treats a payout below the dust limit as none'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:941-945, 960-972', 'the SDK runs that check only in a sync, to skip the chain check of a small leaf'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:67-75', 'the SDK skips a leaf as FeeExceedsValue only when it cannot build a recovery'),
      ('#1173 crates/breez-sdk/core/src/models/mod.rs:3272-3274', "FeeExceedsValue is about a fee of at least the leaf's value"),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:99', 'per the docs, the SDK builds a dust recovery and nodes do not relay it'),
      ('#1173 commit 1ae66aa60', 'per its message, FeeExceedsValue also covers a payout below the dust limit')]),
    ('nice', 'Can the SDK list a leaf it finds already recovered in recover_funds?',
     "In prepare_recover_funds, the SDK reads the output's spend for each leaf the operators report as recovered, unless it already recorded the leaf's recovery. It leaves out a leaf whose recovery is in a block. If miners confirm the recovery after prepare_recover_funds, the SDK still drops the leaf from both leaves and failed in recover_funds. The user can then review an amount and get a receipt without it.",
     'List such a leaf as already recovered in the response, so the app can explain the smaller amount on the receipt.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:657-662, 687-691, 913-922', 'in prepare_recover_funds, the SDK finds the output of each leaf with no recorded recovery or sweep, and leaves out a recovered one'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:437-460, 704-709', 'in prepare_recover_funds, the SDK reads the spend of the output only for a leaf the operators report as recovered'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:334-346, 418-429', 'in recover_funds, the SDK also reads the spend when it stored a co-signed recovery of the output'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:242-259', 'in recover_funds, the SDK returns nothing for a leaf whose recovery is in a block, and stores a spend it finds there'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:542-545', 'the SDK only logs it at debug'),
      ('#1173 crates/breez-sdk/breez-itest/tests/unilateral_exit.rs:3949-3955', 'for an older quote, the SDK returns empty leaves, transactions and failed'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:141', 'per the docs, the SDK lists in failed a cooperative recovery that is not produced')]),
    ('nice', 'Should the SDK report Redo for a recovery on an output that cannot confirm?',
     "Until the SDK sees one of a leaf's direct transactions in a block, it can have the operators co-sign a recovery on an output that never confirms. The SDK now returns such a recovery Unverified, and reports it Ready in check_recover_funds only once the output's transaction is in a block. If miners confirm another direct transaction instead, the SDK keeps reporting the recovery Unverified, with the verdict Valid. Glow then cannot tell this recovery from one still waiting for its output.",
     'Return Redo when the output a co-signed recovery spends can no longer confirm, so the app rebuilds on the right one.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:194-202', "the SDK assumes the held direct transaction's output when no direct transaction above is in a block, or when the lookup of the ancestor's spend failed"),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:490-492, 532-544', 'the SDK takes an output found in a block, then a stored one, then the assumed one, which it does not store'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:747, 755-768', 'in recover_funds, the SDK builds on the assumed output when its lookup has no result'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:276, 366-371', 'the SDK counts a recovery as verified only when it saw the output in a block and knows its spend'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:535-539', 'the SDK returns an unverified recovery as Unverified'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:226-256, 1085-1103', "in check_recover_funds the SDK reports an Unverified recovery Ready only once its output's transaction is in a block, and otherwise keeps the status"),
      ('#1173 crates/breez-sdk/core/src/sdk/chain_queries.rs:281-284, 298', 'the SDK takes a transaction the chain service does not know as in no block, and an outpoint it does not know as unspent'),
      ('#1173 crates/breez-sdk/core/src/persist/mod.rs:182-185', "the SDK's storage removes the recoveries and spend when it replaces the stored output with one at another txid or vout"),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:261, 270-278', 'the SDK returns Redo only from the unilateral check'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:265', 'per the docs, the SDK reports an Unverified cooperative recovery Ready once its output is in a block; nothing on an output that cannot confirm')]),
    ('nice', 'Should the docs say the recovery is version 3?',
     "The SDK now builds the co-signed recovery as version 3, as the operators' own SDK does. Until miners confirm it, nodes relay a transaction spending its output only if that one is also version 3 and small. So the receiving wallet cannot spend the funds or fee-bump the recovery with an ordinary transaction, while the docs still call the recovery an ordinary transaction.",
     'Say in the docs that the recovery is version 3, and what that means for the receiving wallet until miners confirm it.',
     [('#1173 crates/spark-wallet/src/watchtower_exit.rs:371-373', "the SDK builds the recovery as version 3, the version the operators' own SDK uses"),
      ('#1173 commit 769e886b2', 'per the removed comment, the SDK used version 2 so the recipient could bump the fee with an ordinary child'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:30', 'per the docs, only the unilateral CPFP children are version 3'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:216', 'per the docs, the app broadcasts a cooperative recovery alone, as an ordinary transaction')]),
    ('nice', 'Should the SDK undo a recorded recovery the chain service no longer shows?',
     'In prepare_recover_funds the SDK now checks a recorded recovery or sweep while it is fewer than 6 blocks deep, or whenever the app names the leaf. If the chain service shows it in no block, the SDK prepares the leaf again but keeps the record in storage. In recover_funds the SDK then goes by that record, and drops the leaf of a co-signed recovery from both leaves and failed. In a sync the SDK keeps the leaf out of the total, so Glow shows no Recoverable Funds row for it on that device.',
     'When the chain service shows a recorded recovery or sweep in no block, remove the record from storage. The SDK then builds the leaf in recover_funds and counts it in the total again.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:245-263, 444-493', 'in check_recover_funds the SDK records a spend or sweep at its first confirmation'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:325-344, 803-821', 'in prepare_recover_funds the SDK checks a recorded recovery or sweep, always for a named leaf'),
      ('#1173 crates/breez-sdk/core/src/sdk/chain_queries.rs:17-19, 40-42, 121-145', 'else only while it is fewer than 6 blocks deep from the recorded height'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:823-875', 'for one in no block, the SDK leaves the record out for that call and stores only a moved height'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:588-610', 'in recover_funds the SDK reads the records as stored, without that check'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:347-360', 'the SDK counts the leaf as recovered from a stored spend, whatever the chain now shows'),
      ('#1173 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:242-244', 'the SDK builds no recovery for a leaf it counts as recovered'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:542-545', 'and only logs it at debug, so the leaf is in neither leaves nor failed'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:909-911, 983-1001', 'the SDK leaves a leaf with a stored spend or sweep out of the total'),
      ('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:930-939', 'in a sync the SDK checks a stored leaf again only while its check is incomplete'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:72', 'per the docs, the SDK prepares the leaf again when the transaction is in no block'),
      ('#1173 commit c5486d1bd', 'per its message, the SDK keeps a transaction the chain service shows in no block in storage'),
      ('#1173 1ae66aa60 crates/breez-sdk/core/src/sdk/watchtower_exit.rs:1040-1054', 'the SDK used to undo a confirmed recovery until it settled'),
      ('#1173 commit 182168efc', 'its message still says the SDK puts the value back after a reorg')]),
    ('nice', 'Should the SDK build on funding UTXOs it could not follow?',
     'When the chain service fails the requests for some funding UTXOs in recover_funds, the SDK builds on those UTXOs as passed in, even if miners confirmed a spend. Nodes refuse the transactions that spend those UTXOs, and the SDK returns no error. In check_recover_funds, the SDK can still report such a transaction Ready. Glow passes back the same UTXOs, as the docs allow, when it rebuilds a unilateral exit after the watchtower moves a leaf.',
     'When the SDK cannot follow a funding UTXO, return an error, or mark the transactions that spend it Unverified.',
     [('#1173 crates/breez-sdk/core/src/sdk/recover_funds.rs:148-174', 'the SDK looks up the co-signed leaves, then builds the unilateral exit with the same chain queries'),
      ('#1173 crates/breez-sdk/core/src/sdk/chain_queries.rs:76-97, 202-233', 'in a recovery call the SDK sends every request, and stops after a failed one only in a sync'),
      ('#1173 crates/breez-sdk/core/src/sdk/unilateral_exit.rs:220-223', 'the SDK follows the funding UTXOs with those queries before it plans'),
      ('#1173 crates/spark-wallet/src/unilateral_exit.rs:360-362, 380-387', 'the SDK keeps a funding UTXO as passed in unless it read a confirmed spend of it'),
      ('#1173 crates/spark-wallet/src/unilateral_exit.rs:525-550', "in the check, the SDK reads each transaction's first input and its anchor, not the funding of its CPFP child"),
      ('#1173 crates/spark-wallet/src/unilateral_exit.rs:877-879, 921-931', 'the SDK marks a branch Unverified only from its chain read while preparing'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:251', 'per the docs, the app can pass back the same UTXOs and the SDK follows them'),
      ('#1173 docs/breez-sdk/src/guide/recover_funds.md:323', 'per the docs, Unverified also means the SDK could not tell whether its funding is already spent'),
      ('#1173 commit 4adfb8f26', 'per its message, the SDK now sends every request in the recovery calls'),
      ('#1173 review thread on crates/breez-sdk/core/src/sdk/chain_queries.rs (danielgranhao, Oct 8)', 'a reviewer asks to keep the stop for sync only; done in 4adfb8f26')]),
]

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


def note_card(i, title, why, ask, evidence):
    refs = '\n'.join(f'<li><code>{html.escape(ref)}</code><span>{fmt(what)}</span></li>' for ref, what in evidence)
    return f'''<article class="note" id="n{i}">
  <div class="note-head"><span class="note-num">N{i}</span></div>
  <h3>{fmt(title)}</h3>
  <div class="row"><b>Why</b><div>{rich(why)}</div></div>
  <div class="row"><b>Ask</b><div>{rich(ask)}</div></div>
  <details><summary>Evidence</summary><ul class="refs-list">{refs}</ul></details>
</article>'''


def notes():
    """The questions users would notice first; the rest folded into one group."""
    cards = [(severity, note_card(i, *rest)) for i, (severity, *rest) in enumerate(NOTES, 1)]
    main = [card for severity, card in cards if severity == 'should']
    rest = [card for severity, card in cards if severity != 'should']
    group = (f'''<details class="more-notes"><summary>Nice to have: {len(rest)} more questions</summary>
<div class="notes">{''.join(rest)}</div></details>''' if rest else '')
    return '\n'.join(main) + '\n' + group


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
