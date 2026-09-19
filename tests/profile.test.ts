/**
 * Registration identity and the payout profile.
 *
 * The age check gets the most attention here because it is the one with a
 * boundary that people are born exactly on.
 */
import { describe, expect, it } from 'vitest';
import {
  MINIMUM_AGE_YEARS,
  RESTRICTED_COUNTRIES,
  ageInYears,
  checkPayoutProfile,
  checkRegistrationIdentity,
  geographicEligibilityIsEnforceable,
} from '@/domain/customer/profile';
import { COUNTRY_CODES, countryOptions, isKnownCountryCode } from '@/domain/customer/countries';

const ok = { legalName: 'Dana Reyes', countryCode: 'US' };

describe('age', () => {
  it('counts whole years by calendar date', () => {
    expect(ageInYears(new Date('2000-06-15T00:00:00Z'), new Date('2026-06-14T00:00:00Z'))).toBe(25);
    expect(ageInYears(new Date('2000-06-15T00:00:00Z'), new Date('2026-06-15T00:00:00Z'))).toBe(26);
  });

  it('turns 18 on the birthday, not the day after', () => {
    const dob = new Date('2008-09-19T00:00:00Z');
    const dayBefore = checkRegistrationIdentity(
      { ...ok, dateOfBirth: dob },
      new Date('2026-09-18T12:00:00Z'),
    );
    const onTheDay = checkRegistrationIdentity(
      { ...ok, dateOfBirth: dob },
      new Date('2026-09-19T00:00:00Z'),
    );
    expect(dayBefore.problems).toContain('UNDER_AGE');
    expect(onTheDay.ok).toBe(true);
  });

  it('handles a 29 February birthday without drifting a day', () => {
    // 18 * 365.25 days after 2008-02-29 lands on 2026-02-28, so a duration-based
    // age would let this person in a day early.
    const leapling = new Date('2008-02-29T00:00:00Z');
    expect(ageInYears(leapling, new Date('2026-02-28T00:00:00Z'))).toBe(17);
    expect(ageInYears(leapling, new Date('2026-03-01T00:00:00Z'))).toBe(18);
  });

  it('rejects a date of birth in the future rather than reading it as very old', () => {
    const result = checkRegistrationIdentity(
      { ...ok, dateOfBirth: new Date('2030-01-01T00:00:00Z') },
      new Date('2026-09-19T00:00:00Z'),
    );
    expect(result.problems).toContain('DOB_IN_FUTURE');
    expect(result.problems).not.toContain('UNDER_AGE');
  });

  it('requires a date of birth at all', () => {
    const result = checkRegistrationIdentity({ ...ok, dateOfBirth: null }, new Date());
    expect(result.problems).toContain('DOB_MISSING');
  });
});

describe('country', () => {
  const adult = new Date('1990-01-01T00:00:00Z');

  it('accepts a known alpha-2 code', () => {
    expect(checkRegistrationIdentity({ ...ok, dateOfBirth: adult }, new Date()).ok).toBe(true);
  });

  it('rejects anything that is not two letters', () => {
    for (const bad of ['', 'USA', 'u', '12']) {
      const result = checkRegistrationIdentity(
        { ...ok, countryCode: bad, dateOfBirth: adult },
        new Date(),
      );
      expect(result.ok).toBe(false);
    }
  });

  it('offers every ISO 3166-1 country, each with a name and no duplicates', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.every((c) => isKnownCountryCode(c))).toBe(true);
    expect(countryOptions('en').every((o) => o.name.length > 0)).toBe(true);
  });

  it('does not claim geographic eligibility is enforced, because no list is approved', () => {
    // Capturing a country is not the same as having decided which are acceptable.
    expect(RESTRICTED_COUNTRIES.status).toBe('UNRESOLVED');
    expect(RESTRICTED_COUNTRIES.value).toEqual([]);
    expect(geographicEligibilityIsEnforceable()).toBe(false);
  });
});

describe('payout profile', () => {
  const complete = {
    phone: '+1 555 0100',
    addressLine1: '1 Example Street',
    addressLine2: null,
    city: 'Chicago',
    region: 'IL',
    postalCode: '60601',
    countryCode: 'US',
  };

  it('is satisfied by address, city, postal code, country and phone', () => {
    expect(checkPayoutProfile(complete).ok).toBe(true);
  });

  it('does not require the second address line or the region', () => {
    expect(checkPayoutProfile({ ...complete, addressLine2: null, region: null }).ok).toBe(true);
  });

  it('treats whitespace as missing', () => {
    expect(checkPayoutProfile({ ...complete, addressLine1: '   ' }).ok).toBe(false);
    expect(checkPayoutProfile({ ...complete, phone: '  ' }).problems).toContain('PHONE_MISSING');
  });

  it('is empty by default, so a new customer cannot request a payout by accident', () => {
    const empty = {
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
    };
    const result = checkPayoutProfile(empty);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['ADDRESS_INCOMPLETE', 'PHONE_MISSING']);
    expect(result.messages.every((m) => m.length > 0)).toBe(true);
  });
});

describe('minimum age constant', () => {
  it('is 18, matching the drafted eligibility policy', () => {
    expect(MINIMUM_AGE_YEARS).toBe(18);
  });
});
