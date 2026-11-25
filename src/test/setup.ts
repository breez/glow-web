import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';

// Tests assert on the English interface, so i18next has to be live or every
// t() call returns its key. Synchronous and English-only on purpose: the real
// init resolves the language over the Capacitor bridge, which tests have no
// business waiting on.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from '../locales/en/common.json';
import enCritical from '../locales/en/critical.json';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'critical'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, critical: enCritical } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock sessionStorage with the same implementation
Object.defineProperty(window, 'sessionStorage', {
  value: localStorageMock,
});

// Mock matchMedia for responsive components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver for components that use it. A real class, not a
// vi.fn factory: motion/react-use-measure call `new ResizeObserver()`.
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Reset mocks between tests
beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
