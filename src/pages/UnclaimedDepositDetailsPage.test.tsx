import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk, DepositInfo, FetchClaimDepositQuoteResponse } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { saveSettings } from '@/services/settings';
import { CLAIM_SUBMITTED_LINE, forgetAnnouncedClaims, takeUnannouncedClaims } from '@/utils/depositClaimQuote';
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

function renderSheet(deposit: DepositInfo, client?: BreezSdk, subscribeToSdkEvents?: SubscribeToSdkEvents) {
  const onChanged = vi.fn();
  const mockClient = client ?? createMockClient();
  render(
    <ToastProvider>
      <WalletProvider client={mockClient} isConnected subscribeToSdkEvents={subscribeToSdkEvents}>
        <UnclaimedDepositDetailsPage deposit={deposit} onBack={vi.fn()} onChanged={onChanged} />
      </WalletProvider>
    </ToastProvider>
  );
  return { onChanged, client: mockClient };
}

// react-modal-sheet's container leaves the whole sheet out of happy-dom's
// accessibility tree, which empties every accessible name, so `getByRole` with
// a name matches nothing here even with `hidden: true`. Match on button text
// instead: a role query that always returns null would pass the negative
// assertions below for the wrong reason.
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

/** The temporary dev setting that gates the priority claim. */
function setPriorityClaim(enabled: boolean) {
  saveSettings({
    depositMaxFee: { type: 'rate', satPerVbyte: 1 },
    priorityDepositClaimEnabled: enabled,
  });
}

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
  forgetAnnouncedClaims();
  // The choice sits behind a dev setting while it is being tested, so the suite
  // below opts in. The gate itself is covered separately.
  setPriorityClaim(true);
});

describe('a confirming deposit with both routes on offer', () => {
  it('prices both without being asked, the quote being a pure read', async () => {
    const client = withQuote(quote());
    renderSheet(makeDeposit(), client);

    await waitFor(() => expect(client.fetchClaimDepositQuote).toHaveBeenCalledWith({
      txid: 'a'.repeat(64), vout: 0,
    }));
    expect(await screen.findByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
  });

  it('shows what each route costs and how long it takes', async () => {
    renderSheet(makeDeposit(), withQuote(quote()));

    await screen.findByText('Priority');
    // Early is claimable at the current depth; maturity is 2 blocks out.
    expect(button(/^Priority/)).toHaveTextContent('Now');
    expect(button(/^Standard/)).toHaveTextContent('~20 min');
    expect(button(/^Standard/)).toHaveTextContent('198');
  });

  it('says nothing about waiting, the options and button speaking for it', async () => {
    renderSheet(makeDeposit(), withQuote(quote()));

    await screen.findByText('Priority');
    expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
  });

  it('marks the estimated fee and leaves the quoted one bare', async () => {
    renderSheet(makeDeposit(), withQuote(quote()));

    await screen.findByText('Priority');
    // The provider will not quote maturity before a deposit matures.
    expect(button(/^Standard/).textContent).toContain('~');
    expect(button(/^Priority/).textContent).not.toContain('~');
  });

  it('carries the estimate marker into the breakdown, which reprices too', async () => {
    renderSheet(makeDeposit(), withQuote(quote()));

    await screen.findByText('Priority');
    const feeRow = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';
    expect(feeRow('Priority fee')).not.toContain('~');
    fireEvent.click(button(/^Standard/));
    expect(feeRow('Network fee')).toContain('~');
  });

  it('re-prices when a block lands, so the route unlocks without reopening', async () => {
    const client = withQuote(quote({ confirmations: 0 }));
    const stream = eventStream();
    renderSheet(makeDeposit(), client, stream.subscribe);

    // Early unlocks at depth 1, and the deposit is at 0: nothing to claim yet.
    await screen.findByText('Priority');
    expect(screen.getByText('Waiting for 1 confirmation.')).toBeInTheDocument();

    vi.mocked(client.fetchClaimDepositQuote).mockResolvedValue(quote({ confirmations: 1 }));
    stream.emitSynced();

    await waitFor(() => expect(screen.queryByText('Waiting for 1 confirmation.')).toBeNull());
    expect(button('Claim now')).toBeEnabled();
  });

  it('does not re-price under a claim already sent', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    // Never settles: the claim stays in flight for the whole test.
    vi.mocked(client.claimDeposit).mockReturnValue(new Promise(() => {}));
    renderSheet(makeDeposit(), client, stream.subscribe);

    fireEvent.click(await screen.findByText('Claim now'));
    await screen.findByText('Processing...');
    const quotesBefore = vi.mocked(client.fetchClaimDepositQuote).mock.calls.length;

    stream.emitSynced();
    await waitFor(() => expect(screen.getByText('Processing...')).toBeInTheDocument());
    expect(vi.mocked(client.fetchClaimDepositQuote).mock.calls).toHaveLength(quotesBefore);
  });

  it('stands down when background sync claims the deposit under the sheet', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    const { onChanged } = renderSheet(makeDeposit(), client, stream.subscribe);
    await screen.findByText('Priority');

    // Claimed elsewhere: it has left the unclaimed set entirely.
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({ deposits: [] });
    stream.emitSynced();

    // Closing is the honest move: the routes on screen no longer apply.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a refused automatic claim when the deposit matures under the sheet', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    renderSheet(makeDeposit(), client, stream.subscribe);
    await screen.findByText('Priority');

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
    expect(queryButton('Claim now')).toBeNull();
  });

  it('does not let a sync re-announce a claim the sheet already toasted', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockResolvedValue({});
    const { onChanged } = renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    // Sync reports the same outpoint as submitted; it is no longer news.
    expect(takeUnannouncedClaims([makeDeposit()])).toEqual([]);
  });

  it('does not re-read under an approval already sent', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    renderSheet(makeDeposit(), client, stream.subscribe);
    await screen.findByText('Priority');

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
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));
    await screen.findByText('network unreachable');
    // The options came from the first quote and still describe the deposit.
    expect(queryButton(/^Priority/)).not.toBeNull();
    expect(queryButton(/^Standard/)).not.toBeNull();
  });

  it('leaves a deposit at maturity depth to the automatic claim', async () => {
    // Deep enough for Standard, which is not the user's to commit: the SDK
    // claims it at maturity, so offering a button would only race that.
    renderSheet(makeDeposit(), withQuote(quote({ confirmations: 3 })));

    await screen.findByText('Standard');
    fireEvent.click(button(/^Standard/));
    expect(screen.getByText('This transfer will be claimed automatically.')).toBeInTheDocument();
    expect(queryButton(/^Claim/)).toBeNull();
  });

  it('still commits the early route itself', async () => {
    renderSheet(makeDeposit(), withQuote(quote({ confirmations: 3 })));

    await screen.findByText('Priority');
    expect(button('Claim now')).toBeEnabled();
    expect(screen.queryByText('This transfer will be claimed automatically.')).toBeNull();
  });

  it('reports a claim already in flight as submitted, not as a failure', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(
      new Error('deposit claim in progress for a...a:0'),
    );
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({ instantClaimStatus: { type: 'submitted', claimId: 'c' } })],
    });
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));
    await screen.findByText(CLAIM_SUBMITTED_LINE);
    expect(screen.queryByText(/in progress/)).toBeNull();
  });

  it('drops the previous route failure when the other is chosen', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('network unreachable'));
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));
    await screen.findByText('network unreachable');

    fireEvent.click(screen.getByText('Standard'));
    // It priced the route that is no longer selected.
    expect(screen.queryByText('network unreachable')).not.toBeInTheDocument();
  });

  it('drops the previous route re-price when the other is chosen', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('Max deposit claim fee exceeded'));
    vi.mocked(client.fetchClaimDepositQuote)
      .mockResolvedValueOnce(quote())
      .mockResolvedValue(quote({
        instant: { confirmationsRequired: 1, creditAmountSats: 91_000, feeSats: 9_000,
          feeRateSatPerVbyte: 9, isEstimate: false },
      }));
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));
    await screen.findByText('Fee changed');

    fireEvent.click(button(/^Standard/));
    expect(screen.queryByText('Fee changed')).not.toBeInTheDocument();
  });

  it('defaults to the early route and prices the breakdown against it', async () => {
    renderSheet(makeDeposit(), withQuote(quote()));

    await screen.findByText('Priority');
    expect(screen.getByText('Priority fee').parentElement).toHaveTextContent('3 200');
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('96 800');
  });

  it('reprices the breakdown when the other route is chosen', async () => {
    renderSheet(makeDeposit(), withQuote(quote()));

    fireEvent.click(await screen.findByText('Standard'));

    expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198');
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('99 802');
  });

  it('claims at a ceiling that covers the chosen route', async () => {
    const client = withQuote(quote());
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));

    await waitFor(() => expect(client.claimDeposit).toHaveBeenCalled());
    // Below the quoted fee the SDK declines the route and waits for maturity.
    expect(vi.mocked(client.claimDeposit).mock.calls[0][0]).toEqual({
      txid: 'a'.repeat(64), vout: 0, maxFee: { type: 'fixed', amount: 3_200 },
    });
  });

  it('announces an early claim, which settles asynchronously', async () => {
    const client = withQuote(quote());
    // No payment: claimed early, so nothing else reports it.
    vi.mocked(client.claimDeposit).mockResolvedValue({});
    const { onChanged } = renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));

    expect(await screen.findByText('Claim Submitted')).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
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
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));

    expect(await screen.findByText('Fee changed')).toBeInTheDocument();
    expect(screen.getByText('Claim again to accept the new fee.')).toBeInTheDocument();
    // The card says it better than the SDK's message, so that stays off screen.
    expect(screen.queryByText(/early claim was declined/)).not.toBeInTheDocument();
    // The new figure lives in the breakdown, which has repriced.
    expect(screen.getByText('Priority fee').parentElement).toHaveTextContent('4 600');
  });

  it('keeps the raw error when the fee is not what failed', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('network unreachable'));
    renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));

    expect(await screen.findByText('network unreachable')).toBeInTheDocument();
    expect(screen.queryByText('Fee changed')).not.toBeInTheDocument();
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

  it('says how much longer rather than offering a dead button', async () => {
    renderSheet(makeDeposit(), withQuote(notYet()));

    expect(await screen.findByText('Waiting for 1 confirmation.')).toBeInTheDocument();
    // Calling claimDeposit before the floor throws, so nothing is pressable.
    expect(queryButton('Claim now')).not.toBeInTheDocument();
  });
});

describe('a deposit the provider will not front', () => {
  it('keeps the layout but fades the route that is not on offer', async () => {
    const noEarly = quote();
    delete noEarly.instant;
    renderSheet(makeDeposit(), withQuote(noEarly));

    await screen.findByText('Priority');
    // aria-disabled rather than disabled, so it still reads as a route that
    // exists and is unavailable instead of vanishing from the group.
    expect(button(/^Priority/)).toHaveAttribute('aria-disabled', 'true');
    expect(button(/^Priority/)).toHaveTextContent('Not available');
    // Still inert: tapping it must not steal the selection from Standard.
    fireEvent.click(button(/^Priority/));
    expect(button(/^Priority/)).toHaveAttribute('aria-checked', 'false');
    expect(button(/^Standard/)).toHaveAttribute('aria-checked', 'true');
    // Waiting is still priced, so the screen says what the claim will cost.
    expect(button(/^Standard/)).toHaveTextContent('198');
    expect(screen.getByText('Network fee').parentElement).toHaveTextContent('198');
  });

  it('leaves nothing to press, the claim happening at maturity', async () => {
    const noEarly = quote();
    delete noEarly.instant;
    renderSheet(makeDeposit(), withQuote(noEarly));

    await screen.findByText('Priority');
    expect(queryButton('Claim now')).not.toBeInTheDocument();
    expect(queryButton('Claim')).not.toBeInTheDocument();
  });

  it('offers nothing when the early route unlocks no sooner than waiting', async () => {
    // Same depth as maturity: an "early" route that saves nothing.
    const pointless = quote({
      instant: {
        confirmationsRequired: 3, creditAmountSats: 96_800, feeSats: 3_200,
        feeRateSatPerVbyte: 4, isEstimate: false,
      },
    });
    renderSheet(makeDeposit(), withQuote(pointless));

    await waitFor(() => expect(screen.queryByText('Priority')).not.toBeInTheDocument());
  });
});

describe('a claim already in flight', () => {
  const inFlight = (isMature = false) =>
    makeDeposit({ isMature, instantClaimStatus: { type: 'submitted', claimId: 'c' } });

  it('reports the claim in the same words as the toast, and offers nothing', async () => {
    const client = withQuote(quote());
    renderSheet(inFlight(), client);

    expect(screen.getByText(CLAIM_SUBMITTED_LINE)).toBeInTheDocument();
    expect(queryButton('Claim now')).not.toBeInTheDocument();
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    // No point pricing a deposit whose claim is already settling.
    expect(client.fetchClaimDepositQuote).not.toHaveBeenCalled();
  });

  it('withdraws the options when a sync reports the claim as submitted', async () => {
    const client = withQuote(quote());
    const stream = eventStream();
    renderSheet(makeDeposit(), client, stream.subscribe);
    await screen.findByText('Priority');

    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({
      deposits: [makeDeposit({ instantClaimStatus: { type: 'submitted', claimId: 'c' } })],
    });
    stream.emitSynced();

    // The quote is still loaded: only the in-flight status hides the choice.
    await screen.findByText(CLAIM_SUBMITTED_LINE);
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(queryButton(/^Claim/)).toBeNull();
  });

  it('still reports it once the deposit confirms, the SDK skipping it either way', () => {
    renderSheet(inFlight(true), withQuote(quote()));
    expect(screen.getByText(CLAIM_SUBMITTED_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/claimed automatically/)).not.toBeInTheDocument();
  });
});

describe('a route the background sync passed over', () => {
  it('offers it anyway, the quote being priced regardless of the ceiling', async () => {
    // A manual claim authorises the quoted fee itself, so a past decline against
    // the configured ceiling has no bearing on what is offered here.
    renderSheet(
      makeDeposit({ instantClaimStatus: { type: 'declined', maxFeeSats: 400, confirmations: 1 } }),
      withQuote(quote()),
    );

    expect(await screen.findByText('Priority')).toBeInTheDocument();
    expect(button('Claim now')).toBeInTheDocument();
    expect(screen.queryByText(/above your limit/)).not.toBeInTheDocument();
  });
});

describe('a deposit claimed while the sheet was working', () => {
  it('stands down rather than reporting a failure over it', async () => {
    const client = withQuote(quote());
    vi.mocked(client.claimDeposit).mockRejectedValue(new Error('already claimed'));
    // Gone from the unclaimed set: something else got to it first.
    vi.mocked(client.listUnclaimedDeposits).mockResolvedValue({ deposits: [] });
    const { onChanged } = renderSheet(makeDeposit(), client);

    fireEvent.click(await screen.findByText('Claim now'));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByText('already claimed')).not.toBeInTheDocument();
    expect(screen.queryByText('Fee changed')).not.toBeInTheDocument();
  });
});

describe('the dev setting that gates it', () => {
  it('offers nothing and asks for no quote while it is off', async () => {
    setPriorityClaim(false);
    const client = withQuote(quote());
    renderSheet(makeDeposit(), client);

    // Falls back to what the sheet was before the feature.
    await waitFor(() => expect(screen.getByText(/Waiting for 3 confirmations/)).toBeInTheDocument());
    expect(client.fetchClaimDepositQuote).not.toHaveBeenCalled();
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(queryButton('Claim now')).not.toBeInTheDocument();
  });
});

describe('when the quote cannot be fetched', () => {
  it('falls back to plain waiting rather than a broken offer', async () => {
    renderSheet(makeDeposit(), withQuote(new Error('offline')));

    await waitFor(() => expect(screen.getByText(/Waiting for 3 confirmations/)).toBeInTheDocument());
    expect(queryButton('Claim now')).not.toBeInTheDocument();
  });
});
