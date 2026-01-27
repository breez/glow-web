import {
    DEFAULT_SEED,
    DEFAULT_PAYMENT_COUNT,
    DEFAULT_MIN_AMOUNT,
    DEFAULT_MAX_AMOUNT,
    DEFAULT_MIN_DELAY_MS,
    DEFAULT_MAX_DELAY_MS,
    DEFAULT_RETURN_INTERVAL,
    MAX_INITIAL_FUNDING,
} from '../../src/constants/faucet';

/**
 * A single payment to execute in the benchmark.
 */
export interface PaymentSpec {
    /** Amount to send in satoshis */
    amountSats: number;
    /** Delay before this payment in milliseconds */
    delayMs: number;
}

/**
 * Configuration for generating payment scenarios.
 */
export interface ScenarioConfig {
    seed: number;
    paymentCount: number;
    minAmount: number;
    maxAmount: number;
    minDelayMs: number;
    maxDelayMs: number;
    returnInterval: number;
}

export const DEFAULT_SCENARIO_CONFIG: ScenarioConfig = {
    seed: DEFAULT_SEED,
    paymentCount: DEFAULT_PAYMENT_COUNT,
    minAmount: DEFAULT_MIN_AMOUNT,
    maxAmount: DEFAULT_MAX_AMOUNT,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    returnInterval: DEFAULT_RETURN_INTERVAL,
};

/**
 * Validate that the config is compatible with the max initial funding limit.
 */
export function validateConfig(config: ScenarioConfig): void {
    // Rough estimate: we need enough buffer for at least return_interval payments
    // before receiving funds back
    const minBuffer = config.maxAmount * Math.max(1, config.returnInterval);
    if (minBuffer > MAX_INITIAL_FUNDING) {
        throw new Error(
            `maxAmount (${config.maxAmount}) * returnInterval (${config.returnInterval}) = ${minBuffer} ` +
            `exceeds MAX_INITIAL_FUNDING (${MAX_INITIAL_FUNDING}). ` +
            `Reduce maxAmount or returnInterval.`
        );
    }
}

/**
 * Named scenario presets.
 */
export enum ScenarioPreset {
    Random = 'random',
    EdgeCases = 'edge-cases',
}

/**
 * Simple seeded random number generator (Park-Miller LCG).
 * Used to ensure reproducible benchmarks across runs.
 */
class SeededRNG {
    private state: number;

    constructor(seed: number) {
        this.state = seed % 2147483647;
        if (this.state <= 0) this.state += 2147483646;
    }

    next(): number {
        this.state = (this.state * 16807) % 2147483647;
        return this.state;
    }

    /** Returns float [0, 1) */
    nextFloat(): number {
        return (this.next() - 1) / 2147483646;
    }

    /** Returns integer [min, max] inclusive */
    range(min: number, max: number): number {
        return Math.floor(this.nextFloat() * (max - min + 1)) + min;
    }
}

/**
 * Generate seeded pseudo-random payments.
 */
function generateRandomPayments(config: ScenarioConfig): PaymentSpec[] {
    const rng = new SeededRNG(config.seed);
    const payments: PaymentSpec[] = [];

    for (let i = 0; i < config.paymentCount; i++) {
        const amountSats = rng.range(config.minAmount, config.maxAmount);
        const delayMs = rng.range(config.minDelayMs, config.maxDelayMs);

        payments.push({
            amountSats,
            delayMs,
        });
    }

    return payments;
}

/**
 * Generate deterministic edge-case payments to test specific scenarios.
 */
function generateEdgeCasePayments(config: ScenarioConfig): PaymentSpec[] {
    // Predefined amounts that exercise different leaf configurations
    const edgeAmounts = [
        1,     // Minimum possible
        10,    // Very small
        100,   // Small
        256,   // Power of 2
        500,   // Round number
        1000,  // 1k sats
        1024,  // Power of 2
        2000,  // 2k sats
        4096,  // Power of 2
        5000,  // 5k sats
        7777,  // Odd number
        10000, // 10k sats
        12345, // Arbitrary
        20000, // 20k sats
        32768, // Power of 2
        50000, // 50k sats (if within range)
    ];

    // Filter to amounts within config range
    const validAmounts = edgeAmounts.filter(
        (a) => a >= config.minAmount && a <= config.maxAmount
    );

    if (validAmounts.length === 0) {
        // Fall back to random if no edge cases fit the range
        return generateRandomPayments(config);
    }

    const delayMs = Math.floor((config.minDelayMs + config.maxDelayMs) / 2);
    const payments: PaymentSpec[] = [];

    for (let i = 0; i < config.paymentCount; i++) {
        const amountSats = validAmounts[i % validAmounts.length];
        payments.push({
            amountSats,
            delayMs,
        });
    }

    return payments;
}

/**
 * Generate payment specifications for a benchmark run.
 */
export function generatePayments(
    config: ScenarioConfig = DEFAULT_SCENARIO_CONFIG,
    preset: ScenarioPreset = ScenarioPreset.Random
): PaymentSpec[] {
    validateConfig(config);

    switch (preset) {
        case ScenarioPreset.Random:
            return generateRandomPayments(config);
        case ScenarioPreset.EdgeCases:
            return generateEdgeCasePayments(config);
        default:
            return generateRandomPayments(config);
    }
}
