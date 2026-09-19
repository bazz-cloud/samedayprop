/**
 * The platform choice is part of what was bought.
 *
 * Three things have to stay true: the choice is stored and honoured, an
 * unverified platform cannot be sold in production, and neither adapter ever
 * reports success for something it did not do.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATFORM, PLATFORMS, getPlatform, isPlatformKey } from '@/domain/catalog/platforms';
import { RithmicProvider } from '@/server/providers/trading/rithmic';
import { TradovateProvider } from '@/server/providers/trading/tradovate';
import { usd } from '@/domain/money/money';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('platform catalog', () => {
  it('offers exactly the two the owner asked for', () => {
    expect(PLATFORMS.value.map((p) => p.key)).toEqual(['TRADOVATE', 'RITHMIC']);
    expect(isPlatformKey('TRADOVATE')).toBe(true);
    expect(isPlatformKey('RITHMIC')).toBe(true);
    expect(isPlatformKey('NINJATRADER')).toBe(false);
  });

  it('defaults to the one this application can actually reach', () => {
    expect(DEFAULT_PLATFORM).toBe('TRADOVATE');
    expect(getPlatform(DEFAULT_PLATFORM).reachableFromThisApp).toBe(true);
  });

  it('records that Rithmic cannot be driven from this application', () => {
    // Not a gap waiting on credentials: R | API+ is a native library, so no
    // amount of access makes it callable from Node. If this ever flips to true
    // it should be because a separate service was built, not because someone
    // assumed a REST API appeared.
    expect(getPlatform('RITHMIC').reachableFromThisApp).toBe(false);
  });

  it('blocks production sale until a platform is contracted', () => {
    expect(PLATFORMS.status).toBe('EXTERNAL');
    for (const platform of PLATFORMS.value) {
      expect(platform.outstanding.length).toBeGreaterThan(0);
    }
  });
});

describe('Tradovate configuration', () => {
  it('refuses to construct without the key, the secret and the CID', () => {
    // Tradovate issues a key AND a secret from Dashboards, and the CID comes
    // with partner access. Failing at construction beats a confusing 401 on
    // the first real call.
    expect(
      () => new TradovateProvider('SANDBOX', 'https://x.invalid', 'key', 'secret', ''),
    ).toThrow(/CID/);
    expect(
      () => new TradovateProvider('SANDBOX', 'https://x.invalid', 'key', '', 'cid'),
    ).toThrow(/API secret/);
    expect(() => new TradovateProvider('SANDBOX', '', 'key', 'secret', 'cid')).toThrow(/base URL/);
  });

  it('never puts the API secret VALUE on the config object', () => {
    // Config gets passed into views, logged, and occasionally serialised into a
    // page, so a credential that can sign requests is read at the point of use
    // instead. Checked against the source rather than a resolved config,
    // because in tests the variable is unset and any value assertion would
    // pass vacuously.
    //
    // The NAME is allowed to appear — the setup checklist reports which
    // settings are missing, and naming them is the whole point of it.
    const source = readFileSync(join(__dirname, '..', 'src/server/config.ts'), 'utf8');
    const reads = source.match(/env\('TRADOVATE_API_SECRET'\)/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(source).toMatch(/if \(!env\('TRADOVATE_API_SECRET'\)\) missing\.push/);

    // And the adapter gets it straight from the environment.
    const registry = readFileSync(join(__dirname, '..', 'src/server/providers/registry.ts'), 'utf8');
    expect(registry).toContain('process.env.TRADOVATE_API_SECRET');
  });
});

describe('neither adapter pretends', () => {
  const account = 'acct-1';

  it('refuses everything in PRODUCTION until a real call has been seen to work', async () => {
    // DOCUMENTED means written from the spec and never run. Production is the
    // one place that distinction has to bite.
    const provider = new TradovateProvider(
      'PRODUCTION',
      'https://demo.tradovateapi.com/v1',
      'key',
      'secret',
      'cid',
    );
    await expect(
      provider.fetchAccountSnapshot('1'),
    ).rejects.toThrow(/DOCUMENTED/);
  });

  it('never sends EOD as the drawdown mode', () => {
    // Our published rule is an intraday threshold that follows unrealized
    // gains. Tradovate calls that RealTime. EOD measures only at the close and
    // is a materially looser product — sending it would mean the site says one
    // thing and the platform enforces another.
    const source = readFileSync(
      join(__dirname, '..', 'src/server/providers/trading/tradovate.ts'),
      'utf8',
    );
    expect(source).toContain("'RealTime'");
    expect(source).not.toMatch(/trailingMaxDrawdownMode:\s*'EOD'/);
  });

  it('never asks Tradovate to hold a password for the trader', () => {
    // The spec allows a password on user creation. Using it would put a
    // reusable platform credential in our memory, our logs and our error
    // reports.
    const source = readFileSync(
      join(__dirname, '..', 'src/server/providers/trading/tradovate.ts'),
      'utf8',
    );
    // The REQUEST BODY, not the prose around it — the comment above the call
    // explains why no password is sent, and matching on that would make this
    // test pass on the explanation rather than the code.
    const body = source.slice(source.indexOf('users: ['), source.indexOf('const userResult'));
    expect(body).not.toMatch(/password/);
  });

  it('still refuses to deduct a simulated balance, which is the dangerous one', async () => {
    const provider = new TradovateProvider(
      'SANDBOX',
      'https://demo-api.staging.ninjatrader.dev/v1',
      'key',
      'secret',
      'cid',
    );
    await expect(
      provider.adjustSimBalance('1', usd('500.00'), 'payout', 'k'),
    ).rejects.toThrow(/UNVERIFIED/);
  });

  it('runs outside production so the integration can actually be exercised', async () => {
    // In SANDBOX the capability gate lets it through, so the failure comes
    // from the network rather than from the gate. That is the point: this code
    // is meant to be run against staging and promoted.
    const provider = new TradovateProvider(
      'SANDBOX',
      'https://demo-api.staging.ninjatrader.dev/v1',
      'key',
      'secret',
      'cid',
    );
    await expect(
      provider.provisionAccount({
        orderId: 'o',
        userId: 'u',
        email: 'a@b.invalid',
        legalName: 'A B',
        planKey: 'SIM_50K',
        startingBalance: usd('50000.00'),
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/(fetch|network|ENOTFOUND|EAI_AGAIN|failed|authentication)/i);
  }, 20000);

  it('Rithmic refuses account creation as UNSUPPORTED, not merely unverified', async () => {
    // The distinction matters: Rithmic does not open accounts at all, a broker
    // or FCM does. Marking it UNVERIFIED would imply it is one contract away.
    const provider = new RithmicProvider('SANDBOX');
    expect(provider.capabilities.provisionSimulatedAccount).toBe('UNSUPPORTED');
    expect(provider.capabilities.secureCredentialDelivery).toBe('UNSUPPORTED');
    await expect(provider.fetchAccountSnapshot(account)).rejects.toThrow(/UNVERIFIED|UNSUPPORTED/);
  });
});

/**
 * The live-trading host must not be reachable from configuration.
 *
 * Tradovate publishes one per environment. This business sells simulated
 * accounts only, so the safest way to never route an order to a live exchange
 * is to hold no address for one. Asserted against the source rather than the
 * resolved config, because the point is that the constant does not exist at
 * all — a test that only checked getConfig() would pass just as happily if
 * someone added the host back but left it unselected.
 */
describe('no live trading host anywhere', () => {
  const config = readFileSync(join(__dirname, '..', 'src/server/config.ts'), 'utf8');

  it.each([
    'live.tradovateapi.com',
    'live-api.staging.ninjatrader.dev',
  ])('does not carry %s', (host) => {
    expect(config).not.toContain(host);
  });

  it('exposes only the simulation and market data hosts', async () => {
    const { getConfig } = await import('@/server/config');
    const trading = getConfig().providers.trading;
    expect(Object.keys(trading)).not.toContain('liveBaseUrl');
    for (const value of Object.values(trading)) {
      if (typeof value === 'string') expect(value).not.toMatch(/live/);
    }
  });
});
