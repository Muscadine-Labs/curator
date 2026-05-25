/**
 * Polyfill indexedDB in Node (SSR/static generation) so wagmi/RainbowKit
 * don't throw. Must run before any wallet-related imports.
 */
import { createRequire } from 'module';

if (typeof globalThis.indexedDB === 'undefined' && typeof window === 'undefined') {
  createRequire(import.meta.url)('fake-indexeddb/auto');
}
