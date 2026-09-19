/**
 * Trading platforms the customer chooses between at checkout.
 *
 * This is a COMMERCIAL choice with a very different engineering cost behind
 * each option, and the difference is recorded here rather than discovered
 * later. Researched 2026-09-19; sources in docs/PLATFORM_INTEGRATION.md.
 *
 * TRADOVATE has a partner API built for exactly this use case: a prop firm
 * registers as a partner, receives an API key, and creates users and evaluation
 * accounts through a REST API. It is reachable from this application directly.
 *
 * RITHMIC is not the same shape of thing. It is broker- and FCM-neutral routing
 * infrastructure: it does not open trader accounts, the broker or FCM does, and
 * credentials come from them. Its developer product, R | API+, is a set of C++
 * and .NET libraries rather than a REST API, so it cannot be called from this
 * Node application at all — it needs a separate service in a supported language
 * alongside an FCM relationship and passed conformance testing.
 *
 * Both are EXTERNAL: neither has been contracted, neither has been called, and
 * an account on either one cannot be sold until its capabilities are verified.
 */

import { external, type Governed } from '../config/requirement-status';

export type PlatformKey = 'TRADOVATE' | 'RITHMIC';

export interface PlatformDefinition {
  readonly key: PlatformKey;
  readonly name: string;
  /** One line under the name in the chooser. */
  readonly summary: string;
  /**
   * What the customer needs to know before choosing, in plain terms. Shown at
   * checkout, because a platform choice made at purchase is hard to undo.
   */
  readonly note: string;
  /**
   * Whether this application can provision an account on this platform on its
   * own, once contracted. Rithmic cannot be reached from Node at all.
   */
  readonly reachableFromThisApp: boolean;
  /** What still has to happen before an account here can be sold. */
  readonly outstanding: readonly string[];
}

export const PLATFORMS: Governed<readonly PlatformDefinition[]> = external(
  [
    {
      key: 'TRADOVATE',
      name: 'Tradovate',
      summary: 'Web, desktop and mobile. Included with every account.',
      note:
        'The first time you sign in to Tradovate you will be asked to sign its non-professional ' +
        'market data agreement. You sign that one inside Tradovate, not here, and until you do ' +
        'the account cannot receive market data.',
      reachableFromThisApp: true,
      outstanding: [
        'Obtain organization admin credentials, an API key and a CID from an ' +
          'Evaluation Support representative.',
        'Pass Tradovate conformance testing, which begins with authentication.',
        'Beta test the production key for at least a week before taking real orders.',
        'Confirm which entitlement a simulated prop account needs.',
      ],
    },
    {
      key: 'RITHMIC',
      name: 'Rithmic',
      summary: 'R | Trader Pro and R | API+ for automated strategies.',
      note:
        'Rithmic does not issue accounts itself — a broker or FCM does, and your sign-in comes ' +
        'from them. Expect an extra step we do not control.',
      reachableFromThisApp: false,
      outstanding: [
        'Establish a relationship with an FCM or broker who will carry the accounts.',
        'Request the Rithmic dev kit and build against Rithmic Test.',
        'Pass Rithmic conformance testing before any production connection.',
        'Build a separate C++ or .NET service: R | API+ is a native library, not ' +
          'a REST API, and cannot be called from this application.',
        'Decide who issues the trader their credentials, since Rithmic will not.',
      ],
    },
  ],
  'Neither platform is contracted. Both block production sale of an account bound to them.',
  'Researched 2026-09-19 — see docs/PLATFORM_INTEGRATION.md',
);

const BY_KEY = new Map(PLATFORMS.value.map((platform) => [platform.key, platform]));

export function getPlatform(key: PlatformKey): PlatformDefinition {
  const platform = BY_KEY.get(key);
  if (!platform) throw new Error(`Unknown platform ${key}`);
  return platform;
}

export function isPlatformKey(value: string): value is PlatformKey {
  return BY_KEY.has(value as PlatformKey);
}

/** The default selection at checkout: the one this application can actually reach. */
export const DEFAULT_PLATFORM: PlatformKey = 'TRADOVATE';
