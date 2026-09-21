import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { BreezSdk, DepositInfo, FetchClaimDepositQuoteResponse } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { saveSettings } from '@/services/settings';
import { CLAIM_SUBMITTED_LINE } from '@/utils/depositClaimQuote';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import UnclaimedDepositDetailsPage from './UnclaimedDepositDetailsPage';

type SubscribeToSdkEvents = NonNullable<ComponentProps<typeof WalletProvider>['subscribeToSdkEvents']>;
type SdkEventHandler = Parameters<SubscribeToSdkEvents>[0];

/** Captures the sheet's event handler so a test can drive a sync itself. */
function eventStream() {
  const handlers = new Set<SdkEventHandler>();
  const subscribe: SubscribeToSdkEvents = h => {
    handlers.add(h);
    return () => handlers.delete(h);
  };
  return {
    subscribe,
    emitSynced: () => handlers.forEach(h => h({ type: 'synced' } as Parameters<SdkEventHandler>[0])),
  };
}

function depositWithFee(requiredFeeSats: number): DepositInfo {
  return {
    txid: 'e'.repeat(64),
    vout: 0,
    amountSats: 5555,
    isMature: true,
    claimError: {
      type: 'maxDepositClaimFeeExceeded',
      tx: 'e'.repeat(64),
      vout: 0,
      requiredFeeSats,
      requiredFeeRateSatPerVbyte: requiredFeeSats / 99,
    },
  };
}

// The operator re-quotes on every attempt, so a claim can be rejected for a
// fee the sheet was showing a second earlier. Re-sending that fee fails the
// same way forever, which is what QA hit in #369.
it('retries at the fee the failed claim quoted, not the one it rejected', async () => {
  const client = createMockClient() as unknown as BreezSdk;
  client.claimDeposit = vi.fn().mockRejectedValueOnce(new Error('Max deposit claim fee exceeded'));
  client.listUnclaimedDeposits = vi.fn().mockResolvedValue({ deposits: [depositWithFee(297)] });

  render(
    <WalletProvider client={client} isConnected>
      <UnclaimedDepositDetailsPage deposit={depositWithFee(198)} onBack={vi.fn()} />
    </WalletProvider>,
  );
  await waitForSheetOpen();

  fireEvent.click(screen.getByText('Approve'));
  await waitFor(() => expect(screen.getByText('Network fee changed')).toBeInTheDocument());
  expect(client.claimDeposit).toHaveBeenLastCalledWith(
    expect.objectContaining({ maxFee: { type: 'fixed', amount: 198 } }),
  );

  fireEvent.click(screen.getByText('Approve'));
  await waitFor(() =>
    expect(client.claimDeposit).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxFee: { type: 'fixed', amount: 297 } }),
    ),
  );
});

describe('when the failure is not a fee change', () => {
  it('falls back to the error and offers only a refund', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    client.claimDeposit = vi.fn().mockRejectedValue(new Error('Network error: timed out'));
    client.listUnclaimedDeposits = vi.fn().mockResolvedValue({ deposits: [depositWithFee(198)] });

    render(
      <WalletProvider client={client} isConnected>
        <UnclaimedDepositDetailsPage deposit={depositWithFee(198)} onBack={vi.fn()} />
      </WalletProvider>,
    );
    await waitForSheetOpen();

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Network error: timed out')).toBeInTheDocument());
    expect(screen.queryByText('Approve')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Early claiming, against the unified claim API.
// ---------------------------------------------------------------------------

function makeDeposit(overrides: Partial<DepositInfo> = {}): DepositInfo {
  return { txid: 'a'.repeat(64), vout: 0, amountSats: 100_000, isMature: false, ...overrides } as DepositInfo;
}

/** A quote offering both routes, early claimable at `confirmations`. */
function quote(overrides: Partial<FetchClaimDepositQuoteResponse> = {}): FetchClaimDepositQuoteResponse {
  return {
    amountSats: 100_000,
    confirmations: 1,
    instant: {
      confirmationsRequired: 1, creditAmountSats: 96_800, feeSats: 3_200,
      feeRateSatPerVbyte: 4, isEstimate: false,
    },
    mature: {
      confirmationsRequired: 3, creditAmountSats: 99_802, feeSats: 198,
      feeRateSatPerVbyte: 2, isEstimate: true,
    },
    ...overrides,
  };
}

async function renderSheet(deposit: DepositInfo, client?: BreezSdk, subscribeToSdkEvents?: SubscribeToSdkEvents) {
  const onChanged = vi.fn();
  const mockClient = client ?? createMockClient();
  render(
    <ToastProvider>
      <WalletProvider client={mockClient} isConnected subscribeToSdkEvents={subscribeToSdkEvents}>
        <UnclaimedDepositDetailsPage deposit={deposit} onBack={vi.fn()} onChanged={onChanged} />
      </WalletProvider>
    </ToastProvider>
  );
  await waitForSheetOpen();
  return { onChanged, client: mockClient };
}

// Matches <button> elements by text, whatever their role, so one helper
// reaches both the action buttons and the role="radio" delivery speeds.
function matchingButtons(name: string | RegExp): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter(b => {
    const text = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
    return typeof name === 'string' ? text === name : name.test(text);
  });
}
const queryButton = (name: string | RegExp) => matchingButtons(name)[0] ?? null;
function button(name: string | RegExp): HTMLButtonElement {
  const found = queryButton(name);
  if (!found) {
    const present = Array.from(document.querySelectorAll('button')).map(b => b.textContent);
    throw new Error(`No button matching ${name}. Present: ${JSON.stringify(present)}`);
  }
  return found;
}

/** The paid row, under whichever name its current state gives it. */
const PAID_ROW = /^(Instant|Expedited) delivery/;

/** Picking the paid route is what arms the claim button, so most tests start here. */
async function turnOnInstant() {
  await screen.findByTestId('delivery-speed');
  fireEvent.click(button(PAID_ROW));
}

/** The delivery speed group, present only when both speeds are on offer. */
const queryInstantRow = () => screen.queryByTestId('delivery-speed');
const findInstantRow = () => screen.findByTestId('delivery-speed');

function withQuote(q: FetchClaimDepositQuoteResponse | Error) {
  const client = createMockClient();
  const quoting = vi.mocked(client.fetchClaimDepositQuote);
  if (q instanceof Error) quoting.mockRejectedValue(q);
  else quoting.mockResolvedValue(q);
  // The deposit stays listed: an empty list means it was claimed elsewhere, and
  // the sheet rightly stands down on that rather than reporting a failure.
  vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({ deposits: [makeDeposit()] });
  return client;
}

beforeEach(() => {
  localStorage.clear();
});

describe('while the speeds are still being priced', () => {
  it('says so where they will land, rather than letting the card grow unannounced', async () => {
    const client = createMockClient();
    let priced: (q: FetchClaimDepositQuoteResponse) => void = () => {};
    vi.mocked(client.fetchClaimDepositQuote).mockReturnValue(
      new Promise<FetchClaimDepositQuoteResponse>(resolve => { priced = resolve; }),
    );
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({ deposits: [makeDeposit()] });
    await renderSheet(makeDeposit(), client);

    expect(await screen.findByTestId('delivery-speed-pending')).toHaveTextContent('Checking delivery options');
    expect(queryInstantRow()).toBeNull();

    priced(quote());

    expect(await findInstantRow()).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('delivery-speed-pending')).toBeNull());
  });

  it('stands down when the pricing fails, rather than waiting on it forever', async () => {
    await renderSheet(makeDeposit(), withQuote(new Error('offline')));

    await waitFor(() => expect(screen.queryByTestId('delivery-speed-pending')).toBeNull());
    expect(queryButton('Claim')).toBeNull();
  });
});

describe('a confirming deposit with both routes on offer', () => {
  it('prices both without being asked, the quote being a pure read', async () => {
    const client = withQuote(quote());
    await renderSheet(makeDeposit(), client);

    await waitFor(() => expect(client.fetchClaimDepositQuote).toHaveBeenCalledWith({
      txid: 'a'.repeat(64), vout: 0,
    }));
    expect(await findInstantRow()).toBeInTheDocument();
  });

  it('names both speeds, so waiting is not the unnamed one', async () => {
    const group = await (async () => { await renderSheet(makeDeposit(), withQuote(quote())); return findInstantRow(); })();

    expect(group).toHaveTextContent('Standard delivery');
    expect(group).toHaveTextContent('Instant delivery');
    expect(group).toHaveTextContent('Arrives in seconds');
    // Each speed carries its own fee, in one column down the right.
    expect(group).toHaveTextContent('198');
    expect(group).toHaveTextContent('3 200');
  });

  // Waiting is what happens anyway, so it is never armed without being asked for.
  it('selects standard by default and leaves the button inert', async () => {
    await renderSheet(makeDeposit(), withQuote(quote()));

    await findInstantRow();
    expect(button(/^Standard delivery/)).toHaveAttribute('aria-checked', 'true');
    expect(button(/^Instant delivery/)).toHaveAttribute('aria-checked', 'false');
    expect(button('Claim')).toBeDisabled();
  });

  it('marks the estimated fee and leaves the quoted one bare', async () => {
    await renderSheet(makeDeposit(), withQuote(quote()));

    await findInstantRow();
    // The provider will not quote maturity before a deposit matures.
    expect(button(/^Standard delivery/).textContent).toContain('~');
    expect(button(/^Instant delivery/).textContent).not.toContain('~');
  });

  // The group names both waits, so a line below repeating one says it twice.
  it('leaves the wait to the group rather than restating it', async () => {
    await renderSheet(makeDeposit(), withQuote(quote()));

    await findInstantRow();
    expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Claimed automatically after/)).toBeNull();
  });

  it('carries the estimate marker into the breakdown when waiting is priced', async () => {
    // The provider will not quote maturity before a deposit matures.
    const noEarly = quote();
    delete noEarly.instant;
    await renderSheet(makeDeposit(), withQuote(noEarly));

    await waitFor(() => expect(screen.getByText('Network fee').parentElement?.textContent).toContain('~'));
  });

  it('re-prices when a block lands, so the route unlocks without reopening', async () => {
    const client = withQuote(quote({ confirmations: 0 }));
    const stream = eventStream();
    await renderSheet(makeDeposit(), client, stream.subscribe);

    // Early unlocks at depth 1, and the deposit is at 0: choosable, and named
    // for the wait rather than for an immediacy it cannot deliver yet.
    await findInstantRow();
    expect(button(PAID_ROW)).toHaveTextContent('Expedited delivery');
    expect(button(PAID_ROW)).toHaveTextContent('Unlocks in 1 confirmation');
    await turnOnInstant();
    expect(button(PAID_ROW)).toHaveAttribute('aria-checked', 'true');
    expect(button('Claim')).toBeDisabled();

    vi.mocked(client.fetchClaimDepositQuote).mockResolvedValue(quote({ confirmations: 1 }));
    stream.emitSynced();

    // The block lands and the pick becomes claimable, without reopening.
    await waitFor(() => expect(button('Claim')).toBeEnabled());
    expect(button(PAID_ROW)).toHaveTextContent('Instant delivery');
    expect(button(PAID_ROW)).toHaveTextContent('Arrives in seconds');
  });

  // The provider re-quotes on every sync, so the depth it wants can rise after
  // the paid route was picked. That is a longer wait rather than a refusal, so
  // the pick stands and only the claim is withheld.
  it('holds the pick but withholds the claim when a re-price moves the floor', async () => {
    const client = withQuote(quote({ confirmations: 1 }));
    const stream = eventStream();
    await renderSheet(makeDeposit(), client, stream.subscribe);

    await turnOnInstant();
    expect(button('Claim')).toBeEnabled();
    expect(button(PAID_ROW)).toHaveAttribute('aria-checked', 'true');

    // Same depth, but the provider now wants two confirmations rather than one.
    vi.mocked(client.fetchClaimDepositQuote).mockResolvedValue(quote({
      confirmations: 1,
      instant: { confirmationsRequired: 2, creditAmountSats: 96_800, feeSats: 3_200,
        feeRateSatPerVbyte: 4, isEstimate: false },
    }));
    stream.emitSynced();

    await waitFor(() => expect(button('Claim')).toBeDisabled());
    expect(button(PAID_ROW)).toHaveAttribute('aria-checked', 'true');
    expect(button(PAID_ROW)).toHaveTextContent('Unlocks in 1 confirmation');
    // Still priced at what was picked, which is what the wait is now for.
    expect(screen.getByText('Delivery fee')).toBeInTheDocument();
  });

  it('does not re-price under a claim already sent', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    // Never settles: the claim stays in flight for the whole test.
    vi.mocked(client.claimDeposit).mockReturnValue(new Promise(() => {}));
    await renderSheet(makeDeposit(), client, stream.subscribe);

    await turnOnInstant();
    fireEvent.click(button('Claim'));
    await screen.findByText('Processing...');
    const quotesBefore = vi.mocked(client.fetchClaimDepositQuote).mock.calls.length;

    stream.emitSynced();
    await waitFor(() => expect(screen.getByText('Processing...')).toBeInTheDocument());
    expect(vi.mocked(client.fetchClaimDepositQuote).mock.calls).toHaveLength(quotesBefore);
  });

  it('stands down when background sync claims the deposit under the sheet', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    const { onChanged } = await renderSheet(makeDeposit(), client, stream.subscribe);
    await findInstantRow();

    // Claimed elsewhere: it has left the unclaimed set entirely.
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({ deposits: [] });
    stream.emitSynced();

    // Closing is the honest move: the routes on screen no longer apply.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a refused automatic claim when the deposit matures under the sheet', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    await renderSheet(makeDeposit(), client, stream.subscribe);
    await findInstantRow();

    // It matures with the sheet open and the automatic claim trips the ceiling.
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({
        isMature: true,
        claimError: {
          type: 'maxDepositClaimFeeExceeded',
          tx: 'a'.repeat(64), vout: 0,
          requiredFeeSats: 512, requiredFeeRateSatPerVbyte: 4,
        },
      })],
    });
    stream.emitSynced();

    await waitFor(() => expect(button('Approve')).toBeInTheDocument());
    expect(screen.getByText('Network fee').parentElement).toHaveTextContent('512');
    // The approve panel owns the sheet: no route button still offering a claim.
    expect(queryButton('Claim')).toBeNull();
  });


  it('does not re-read under an approval already sent', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    await renderSheet(makeDeposit(), client, stream.subscribe);
    await findInstantRow();

    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({
        isMature: true,
        claimError: {
          type: 'maxDepositClaimFeeExceeded',
          tx: 'a'.repeat(64), vout: 0,
          requiredFeeSats: 512, requiredFeeRateSatPerVbyte: 4,
        },
      })],
    });
    stream.emitSynced();
    await waitFor(() => expect(button('Approve')).toBeInTheDocument());

    vi.mocked(client.claimDeposit).mockReturnValue(new Promise(() => {}));
    fireEvent.click(button('Approve'));
    await screen.findByText('Processing...');
    const readsBefore = vi.mocked(client.listUnclaimedDeposits).mock.calls.length;

    stream.emitSynced();
    await waitFor(() => expect(screen.getByText('Processing...')).toBeInTheDocument());
    expect(vi.mocked(client.listUnclaimedDeposits).mock.calls).toHaveLength(readsBefore);
  });

  it('keeps the last good quote when a re-price fails', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('network unreachable'));
    // Prices once on open, then the re-quote behind the failed claim fails too.
    vi.mocked(client.fetchClaimDepositQuote)
      .mockResolvedValueOnce(quote())
      .mockRejectedValue(new Error('quote unavailable'));
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));
    await screen.findByText('network unreachable');
    // The row came from the first quote and still describes the deposit.
    expect(queryInstantRow()).not.toBeNull();
  });

  // Once the automatic claim is due the spread buys one sync cycle at sixteen
  // times the fee the SDK is about to pay anyway, so it stops being offered.
  // Otherwise this reads exactly like a deposit the provider never offered to
  // front, which is a different thing entirely.
  it('says the claim is happening, not that it will', async () => {
    await renderSheet(makeDeposit(), withQuote(quote({ confirmations: 3 })));

    await waitFor(() =>
      expect(screen.getByText('This transfer is being claimed.')).toBeInTheDocument());
  });

  it('withdraws the early route once the automatic claim is already due', async () => {
    await renderSheet(makeDeposit(), withQuote(quote({ confirmations: 3 })));

    await waitFor(() =>
      expect(screen.getByText('This transfer is being claimed.')).toBeInTheDocument());
    expect(queryInstantRow()).toBeNull();
    expect(queryButton(/^Claim/)).toBeNull();
    // Waiting is what will happen, so waiting is what the breakdown prices.
    expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198');
  });

  it('reports a claim already in flight as submitted, not as a failure', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(
      new Error('deposit claim in progress for a...a:0'),
    );
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({ instantClaimStatus: { type: 'submitted', claimId: 'c' } })],
    });
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));
    await screen.findByText(CLAIM_SUBMITTED_LINE);
    expect(screen.queryByText(/in progress/)).toBeNull();
  });

  // The switch sits above the breakdown because turning it on reprices it.
  it('prices the wait until the paid route is asked for', async () => {
    await renderSheet(makeDeposit(), withQuote(quote()));

    await findInstantRow();
    expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198');
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('99 802');

    await turnOnInstant();
    expect(screen.getByText('Delivery fee').parentElement).toHaveTextContent('3 200');
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('96 800');
  });

  // Priced before it unlocks, the early route would headline the proceeds of a
  // purchase the user cannot make, against a wait that is what will happen.
  it('prices the wait while the early route is still locked', async () => {
    await renderSheet(makeDeposit(), withQuote(quote({ confirmations: 0 })));

    await waitFor(() => expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198'));
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('99 802');
  });

  // The wait belongs to the group, where it can be weighed against the fee for
  // skipping it. With no offer on the table there is nothing to weigh, so the
  // line says what happens and stops.
  it('quotes no wait on the states with nothing to choose', async () => {
    const noEarly = quote();
    delete noEarly.instant;
    await renderSheet(makeDeposit(), withQuote(noEarly));

    await waitFor(() =>
      expect(screen.getByText('This transfer will be claimed automatically.')).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/confirmations \(~/);
  });

  // The Standard row is where a wait earns its place: beside the fee for skipping it.
  it('carries the wait in the group, count first and minutes in parentheses', async () => {
    await renderSheet(makeDeposit(), withQuote(quote()));

    expect(await findInstantRow()).toHaveTextContent('2 confirmations (~20 mins)');
  });

  // Waiting needs no control to happen, but with none on screen the sheet
  // offered the paid route and nothing beside it.
  // Picking Standard again is the whole of "no thanks": it disarms the button
  // and puts the wait back in the breakdown.
  it('disarms again when standard is picked back', async () => {
    const client = withQuote(quote());
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    expect(button('Claim')).toBeEnabled();

    fireEvent.click(button(/^Standard delivery/));
    expect(button('Claim')).toBeDisabled();
    expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198');
    expect(client.claimDeposit).not.toHaveBeenCalled();
  });

  it('offers nothing to turn on when the provider will not front it', async () => {
    const noEarly = quote();
    delete noEarly.instant;
    await renderSheet(makeDeposit(), withQuote(noEarly));

    await waitFor(() => expect(screen.getByText('This transfer will be claimed automatically.')).toBeInTheDocument());
    expect(queryInstantRow()).toBeNull();
  });

  // The reviewer asked for the fee off the label; a screen reader still has to
  // hear what the button buys, so it is described by the row's fee instead.
  it('describes the button by the offer without labelling it with a price', async () => {
    await renderSheet(makeDeposit(), withQuote(quote()));

    await turnOnInstant();
    const cta = button('Claim');
    expect(cta.textContent).not.toMatch(/3 200|3 002/);
    // Described by the whole offer, so the route and its price are both read out.
    expect(document.getElementById(cta.getAttribute('aria-describedby') ?? ''))
      .toHaveTextContent('Instant delivery');
  });

  it('claims at a ceiling that covers the chosen route', async () => {
    const client = withQuote(quote());
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));

    await waitFor(() => expect(client.claimDeposit).toHaveBeenCalled());
    // Below the quoted fee the SDK declines the route and waits for maturity.
    expect(vi.mocked(client.claimDeposit).mock.calls[0][0]).toEqual({
      txid: 'a'.repeat(64), vout: 0, maxFee: { type: 'fixed', amount: 3_200 },
    });
  });

  it('reports an early claim through the caller, not a toast', async () => {
    const client = withQuote(quote());
    // No payment: claimed early, so it settles after the sheet has gone.
    vi.mocked(client.claimDeposit).mockResolvedValue({});
    const { onChanged } = await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByText('Claim Submitted')).toBeNull();
  });
});

// Roy's report: the sheet had Standard selected for nine minutes and then the
// SDK paid the early fee. Waiting was never on offer, so it must not be shown
// as a choice, and the fee on screen has to be the one that will be charged.
describe('an early route the limit already covers', () => {
  const cheap = () => quote({
    confirmations: 0,
    instant: { confirmationsRequired: 1, creditAmountSats: 99_653, feeSats: 347,
      feeRateSatPerVbyte: 4, isEstimate: false },
  });

  beforeEach(() => saveSettings({ depositMaxFee: { type: 'fixed', amount: 500 } }));

  it('picks the route the SDK will take, and prices it', async () => {
    await renderSheet(makeDeposit(), withQuote(cheap()));

    await findInstantRow();
    expect(button(PAID_ROW)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Delivery fee').parentElement).toHaveTextContent('347');
  });

  // Dimmed rather than merely unselected: the user cannot have this outcome,
  // and leaving it tappable would offer a choice that changes nothing.
  it('stands the wait down instead of offering a choice that is not one', async () => {
    await renderSheet(makeDeposit(), withQuote(cheap()));

    await findInstantRow();
    const standard = button(/^Standard delivery/);
    expect(standard).toHaveAttribute('aria-disabled', 'true');
    expect(standard).toHaveAttribute('aria-checked', 'false');
    // Said in words, not by dimming alone.
    expect(standard).toHaveTextContent('Not available');

    fireEvent.click(standard);
    expect(standard).toHaveAttribute('aria-checked', 'false');
    expect(button(PAID_ROW)).toHaveAttribute('aria-checked', 'true');
  });

  // Both can be true of one quote. The approve panel is never reached, because
  // the SDK claims early long before maturity.
  it('drops the maturity warning it would otherwise contradict', async () => {
    const overBoth = cheap();
    overBoth.mature = { confirmationsRequired: 3, creditAmountSats: 99_400, feeSats: 600,
      feeRateSatPerVbyte: 5, isEstimate: true };
    await renderSheet(makeDeposit(), withQuote(overBoth));

    await findInstantRow();
    expect(screen.queryByText(/will be asked to approve/)).toBeNull();
  });

  it('leaves the choice alone once the fee outgrows the limit', async () => {
    saveSettings({ depositMaxFee: { type: 'fixed', amount: 200 } });
    await renderSheet(makeDeposit(), withQuote(cheap()));

    await findInstantRow();
    expect(button(/^Standard delivery/)).toHaveAttribute('aria-checked', 'true');
    expect(button(/^Standard delivery/)).toHaveAttribute('aria-disabled', 'false');
    expect(button(/^Standard delivery/)).not.toHaveTextContent('Not available');
  });
});

// The automatic claim runs only while the fee stays under the configured
// ceiling, so a fee above it means approval, not an automatic claim.
describe('a wait the fee ceiling will not cover', () => {
  it('warns before the refusal instead of promising a claim it cannot make', async () => {
    saveSettings({ depositMaxFee: { type: 'fixed', amount: 400 } });
    const dear = quote({
      mature: { confirmationsRequired: 3, creditAmountSats: 99_400, feeSats: 600,
        feeRateSatPerVbyte: 5, isEstimate: true },
    });
    delete dear.instant;
    await renderSheet(makeDeposit(), withQuote(dear));

    // Future tense, and no buttons: nothing is claimable yet. The panel with
    // Approve and Reject is the state after the SDK has actually been refused.
    const line = await screen.findByText(/will be asked to approve/);
    expect(line).toHaveTextContent('400');
    expect(screen.queryByText(/claimed automatically/i)).toBeNull();
  });

  // The SDK refuses on a sync after maturity, not at maturity itself. Dropping
  // the warning at the boundary would spend that window promising the claim it
  // is about to refuse, which is the promise the warning exists to avoid.
  it('keeps warning once the deposit matures, until the claim is actually refused', async () => {
    saveSettings({ depositMaxFee: { type: 'fixed', amount: 400 } });
    const dear = quote({
      mature: { confirmationsRequired: 3, creditAmountSats: 99_400, feeSats: 600,
        feeRateSatPerVbyte: 5, isEstimate: true },
    });
    delete dear.instant;
    const client = withQuote(dear);
    const confirming = makeDeposit();

    const { rerender } = render(
      <ToastProvider>
        <WalletProvider client={client} isConnected>
          <UnclaimedDepositDetailsPage deposit={confirming} onBack={vi.fn()} />
        </WalletProvider>
      </ToastProvider>,
    );
    await waitForSheetOpen();
    await screen.findByText(/will be asked to approve/);

    // Matured, and the SDK has not refused it yet: no claimError on the record.
    rerender(
      <ToastProvider>
        <WalletProvider client={client} isConnected>
          <UnclaimedDepositDetailsPage deposit={makeDeposit({ isMature: true })} onBack={vi.fn()} />
        </WalletProvider>
      </ToastProvider>,
    );

    expect(screen.getByText(/will be asked to approve/)).toHaveTextContent('400');
    expect(screen.queryByText(/claimed automatically/i)).toBeNull();
  });
});

describe('a fee that rises between quoting and claiming', () => {
  const risen = () => quote({
    instant: {
      confirmationsRequired: 1, creditAmountSats: 95_400, feeSats: 4_600,
      feeRateSatPerVbyte: 6, isEstimate: false,
    },
  });

  it('explains the rise instead of the raw decline, and reprices', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('early claim was declined'));
    vi.mocked(client.fetchClaimDepositQuote)
      .mockResolvedValueOnce(quote())
      .mockResolvedValue(risen());
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));

    // A failed tap, reported like any other failed tap, naming the figure it
    // moved from: the row and the breakdown below already carry the new one.
    // The amount is one element, so it cannot break across lines mid-figure.
    const changed = await screen.findByText(/Your claim did not go through/);
    expect(changed).toHaveTextContent('3 200');
    expect(changed.querySelector('.font-mono')?.textContent).toContain('3 200');
    // Whether to pay the new price is the user's call, so the line does not ask.
    expect(changed.textContent).not.toMatch(/Claim again|accept it/);
    // The line says it better than the SDK's message, so that stays off screen.
    expect(screen.queryByText(/early claim was declined/)).not.toBeInTheDocument();
    expect(screen.getByText('Delivery fee').parentElement).toHaveTextContent('4 600');
  });

  // The container measures content once and holds that snap, so a body that
  // grew when the failure arrived would carry the footer off the bottom of the
  // viewport with it. The cap stays put and the message is scrolled to instead.
  it('keeps the body bounded when the failure appears', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('early claim was declined'));
    vi.mocked(client.fetchClaimDepositQuote)
      .mockResolvedValueOnce(quote())
      .mockResolvedValue(risen());
    await renderSheet(makeDeposit(), client);

    const cap = () => document.querySelector<HTMLElement>('[style*="dvh"]')?.style.maxHeight;
    await turnOnInstant();
    expect(cap()).toBe('74dvh');

    fireEvent.click(button('Claim'));
    await screen.findByText(/did not go through/);
    expect(cap()).toBe('74dvh');
  });

  // A re-price is not gentler news than any other decline: the tap failed and
  // nothing was claimed, so it reads the same way.
  it('reports a re-price as a failure rather than as a note', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('early claim was declined'));
    vi.mocked(client.fetchClaimDepositQuote)
      .mockResolvedValueOnce(quote())
      .mockResolvedValue(risen());
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));

    const line = await screen.findByText(/Your claim did not go through/);
    // The same inline treatment a raw decline gets, and no icon of its own.
    expect(line.className).toContain('text-spark-primary');
    expect(line.querySelector('svg')).toBeNull();
  });

  it('keeps the raw error when the fee is not what failed', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('network unreachable'));
    await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));

    expect(await screen.findByText('network unreachable')).toBeInTheDocument();
    expect(screen.queryByText(/fee changed from/)).toBeNull();
  });
});

describe('an early route that has not unlocked yet', () => {
  const notYet = () => quote({
    confirmations: 0,
    instant: {
      confirmationsRequired: 1, creditAmountSats: 96_800, feeSats: 3_200,
      feeRateSatPerVbyte: 4, isEstimate: false,
    },
  });

  // A wait is not a refusal, so the row is an ordinary choosable one. Dimming
  // is reserved for an outcome the user cannot have, and spending it here left
  // this state looking like one the provider will not front at all.
  it('offers the route at full strength and withholds only the claim', async () => {
    await renderSheet(makeDeposit(), withQuote(notYet()));

    await findInstantRow();
    const waiting = button(PAID_ROW);
    expect(waiting).toHaveAttribute('aria-disabled', 'false');
    expect(waiting).toHaveTextContent('Expedited delivery');
    expect(waiting).toHaveTextContent('Unlocks in 1 confirmation');

    fireEvent.click(waiting);
    expect(waiting).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Delivery fee')).toBeInTheDocument();
    expect(button('Claim')).toBeDisabled();
  });
});

describe('a deposit the provider will not front', () => {
  // A faded, unpressable card at the top of the sheet says less than dropping
  // it and pricing the wait that will actually happen.
  it('drops the route rather than fading it, and prices the wait', async () => {
    const noEarly = quote();
    delete noEarly.instant;
    await renderSheet(makeDeposit(), withQuote(noEarly));

    await waitFor(() =>
      expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198'));
    expect(queryInstantRow()).toBeNull();
    // The count is what moves between one look and the next, so it is what the
    // line carries rather than a wall-clock estimate that would not.
    expect(screen.getByText('This transfer will be claimed automatically.')).toBeInTheDocument();
  });

  it('leaves nothing to press, the claim happening at maturity', async () => {
    const noEarly = quote();
    delete noEarly.instant;
    await renderSheet(makeDeposit(), withQuote(noEarly));

    await waitFor(() => expect(screen.getByText('Network fee')).toBeInTheDocument());
    expect(queryButton(/^Claim/)).toBeNull();
  });

  it('offers nothing when the early route unlocks no sooner than waiting', async () => {
    // Same depth as maturity: an "early" route that saves nothing.
    const pointless = quote({
      instant: {
        confirmationsRequired: 3, creditAmountSats: 96_800, feeSats: 3_200,
        feeRateSatPerVbyte: 4, isEstimate: false,
      },
    });
    await renderSheet(makeDeposit(), withQuote(pointless));

    await waitFor(() => expect(screen.getByText('Network fee')).toBeInTheDocument());
    expect(queryInstantRow()).toBeNull();
  });
});

describe('a claim already in flight', () => {
  // The SDK keeps no fee on a submitted claim and a fresh quote would be a
  // different number, so the sheet remembers what it charged at submit time.
  it('prices a reopened sheet from what the claim actually cost', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockResolvedValue({});
    const submitted = makeDeposit({ instantClaimStatus: { type: 'submitted', claimId: 'c' } });

    const first = await renderSheet(makeDeposit(), client);
    await turnOnInstant();
    fireEvent.click(button('Claim'));
    await waitFor(() => expect(first.onChanged).toHaveBeenCalled());
    cleanup();

    // Reopened mid-settlement: no quote is fetched, so this can only come from
    // the receipt written when the claim was sent.
    await renderSheet(submitted, withQuote(quote()));
    expect(screen.getByText(CLAIM_SUBMITTED_LINE)).toBeInTheDocument();
    expect(screen.getByText('Delivery fee').parentElement).toHaveTextContent('3 200');
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('96 800');
  });

  const inFlight = (isMature = false) =>
    makeDeposit({ isMature, instantClaimStatus: { type: 'submitted', claimId: 'c' } });

  it('reports the claim in the same words as the toast, and offers nothing', async () => {
    const client = withQuote(quote());
    await renderSheet(inFlight(), client);

    expect(screen.getByText(CLAIM_SUBMITTED_LINE)).toBeInTheDocument();
    expect(queryButton('Claim')).toBeNull();
    expect(queryInstantRow()).toBeNull();
    // No point pricing a deposit whose claim is already settling.
    expect(client.fetchClaimDepositQuote).not.toHaveBeenCalled();
  });

  it('withdraws the options when a sync reports the claim as submitted', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    await renderSheet(makeDeposit(), client, stream.subscribe);
    await findInstantRow();

    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({ instantClaimStatus: { type: 'submitted', claimId: 'c' } })],
    });
    stream.emitSynced();

    // The quote is still loaded: only the in-flight status hides the choice.
    await screen.findByText(CLAIM_SUBMITTED_LINE);
    expect(queryInstantRow()).toBeNull();
    expect(queryButton(/^Claim/)).toBeNull();
  });

  it('still reports it once the deposit confirms, the SDK skipping it either way', async () => {
    await renderSheet(inFlight(true), withQuote(quote()));
    expect(screen.getByText(CLAIM_SUBMITTED_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/claimed automatically/)).not.toBeInTheDocument();
  });
});

// The footer never consulted claimError, and isConfirming reads a record the
// sync handler has already moved past, so both could be true at once.
describe('an automatic claim that fails under the sheet', () => {
  it('offers a refund without still offering to claim', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    await renderSheet(makeDeposit(), client, stream.subscribe);
    await findInstantRow();

    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({
        isMature: true,
        claimError: { type: 'generic', message: 'operator unavailable' },
      })],
    });
    stream.emitSynced();

    await screen.findByText('operator unavailable');
    expect(button('Reject')).toBeInTheDocument();
    expect(queryButton(/^Claim/)).toBeNull();
  });
});

describe('a route the background sync passed over', () => {
  it('offers it anyway, the quote being priced regardless of the ceiling', async () => {
    // A manual claim authorises the quoted fee itself, so a past decline against
    // the configured ceiling has no bearing on what is offered here.
    await renderSheet(
      makeDeposit({ instantClaimStatus: { type: 'declined', maxFeeSats: 400, confirmations: 1 } }),
      withQuote(quote()),
    );

    expect(await findInstantRow()).toBeInTheDocument();
    await turnOnInstant();
    expect(button('Claim')).toBeInTheDocument();
    expect(screen.queryByText(/above your limit/)).not.toBeInTheDocument();
  });
});

describe('a deposit claimed while the sheet was working', () => {
  it('stands down rather than reporting a failure over it', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('already claimed'));
    // Gone from the unclaimed set: something else got to it first.
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({ deposits: [] });
    const { onChanged } = await renderSheet(makeDeposit(), client);

    await turnOnInstant();
    fireEvent.click(button('Claim'));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByText('already claimed')).not.toBeInTheDocument();
    expect(screen.queryByText(/fee changed from/)).toBeNull();
  });
});

describe('when the quote cannot be fetched', () => {
  // Nothing is said about depth before a quote lands. The maturity threshold is
  // not the depth the early route opens at, so a figure named here is one the
  // next render contradicts, which is the stale dialog QA saw flash.
  it('falls back to plain waiting rather than a broken offer', async () => {
    await renderSheet(makeDeposit(), withQuote(new Error('offline')));

    await waitFor(() => expect(queryInstantRow()).toBeNull());
    expect(screen.queryByText(/confirmations/)).toBeNull();
    expect(queryButton('Claim')).toBeNull();
  });
});
