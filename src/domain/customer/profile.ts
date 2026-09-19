/**
 * Customer profile: the details needed to pay a real person real money.
 *
 * Deliberately split from registration. The eligibility policy states that
 * identity is verified before the first payout, not before a purchase, so
 * signing up asks for as little as possible and the rest is collected when it
 * is actually needed. Front-loading a tax address onto a checkout that has not
 * earned anything yet costs conversions and collects data we may never use.
 *
 * Two levels, therefore:
 *
 *   REGISTRATION   name, email, password, country of residence, date of birth.
 *                  Country and date of birth are here because they decide
 *                  whether an account may be opened at all.
 *
 *   PAYOUT PROFILE postal address and contact number. Required before the
 *                  first payout request, not before buying.
 *
 * This module holds no PII itself; it decides what is required and whether
 * what was supplied is sufficient.
 */

import { unresolved, type Governed } from '@/domain/config/requirement-status';

/** Minimum age to hold an account, per the drafted eligibility policy. */
export const MINIMUM_AGE_YEARS = 18;

/**
 * Countries we cannot serve.
 *
 * NOT DECIDED, and not invented here: which jurisdictions are excluded is a
 * legal determination (sanctions regimes, plus anywhere this product would
 * need a licence we do not hold). The mechanism is built and the country is
 * captured at registration, so approving a list is a data change rather than
 * a code change. Until a list is approved this application must not claim that
 * geographic eligibility has been checked.
 */
export const RESTRICTED_COUNTRIES: Governed<readonly string[]> = unresolved(
  [],
  'No restricted-country list has been approved. The empty list blocks nobody, and is NOT ' +
    'evidence that any country was cleared. Production sale is blocked until counsel supplies ' +
    'the list.',
  'Drafted eligibility policy — needs legal review',
);

export interface PayoutProfile {
  readonly phone: string | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
}

export type ProfileProblem =
  | 'NAME_MISSING'
  | 'COUNTRY_MISSING'
  | 'COUNTRY_INVALID'
  | 'COUNTRY_RESTRICTED'
  | 'DOB_MISSING'
  | 'DOB_IN_FUTURE'
  | 'UNDER_AGE'
  | 'ADDRESS_INCOMPLETE'
  | 'PHONE_MISSING';

export interface ProfileCheck {
  readonly ok: boolean;
  readonly problems: readonly ProfileProblem[];
  readonly messages: readonly string[];
}

const MESSAGES: Record<ProfileProblem, string> = {
  NAME_MISSING: 'Enter the full legal name you will sign agreements with.',
  COUNTRY_MISSING: 'Select your country of residence.',
  COUNTRY_INVALID: 'That country code was not recognised.',
  COUNTRY_RESTRICTED: 'We are not able to offer accounts in your country.',
  DOB_MISSING: 'Enter your date of birth.',
  DOB_IN_FUTURE: 'That date of birth is in the future.',
  UNDER_AGE: `You must be at least ${MINIMUM_AGE_YEARS} to hold an account.`,
  ADDRESS_INCOMPLETE: 'Enter your street address, city, postal code and country.',
  PHONE_MISSING: 'Enter a contact number.',
};

function describe(problems: readonly ProfileProblem[]): ProfileCheck {
  return { ok: problems.length === 0, problems, messages: problems.map((p) => MESSAGES[p]) };
}

/**
 * Whole years elapsed, by calendar date rather than by dividing milliseconds.
 *
 * A duration-based age is wrong across leap years: someone born on 29 February
 * has a birthday every year, and 18 * 365.25 days is not the same instant as
 * their eighteenth birthday in their own calendar.
 */
export function ageInYears(dateOfBirth: Date, asOf: Date): number {
  let age = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = asOf.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
}

/** Whether this person may open an account at all. */
export function checkRegistrationIdentity(
  identity: { legalName: string; countryCode: string; dateOfBirth: Date | null },
  asOf: Date,
): ProfileCheck {
  const problems: ProfileProblem[] = [];

  if (identity.legalName.trim().length < 2) problems.push('NAME_MISSING');

  const country = identity.countryCode.trim().toUpperCase();
  if (country.length === 0) {
    problems.push('COUNTRY_MISSING');
  } else if (!isValidCountryCode(country)) {
    problems.push('COUNTRY_INVALID');
  } else if (RESTRICTED_COUNTRIES.value.includes(country)) {
    // Unreachable while the list is empty. Wired now so that approving a list
    // is a data change, and so the path is tested before it matters.
    problems.push('COUNTRY_RESTRICTED');
  }

  if (!identity.dateOfBirth) {
    problems.push('DOB_MISSING');
  } else if (identity.dateOfBirth.getTime() > asOf.getTime()) {
    problems.push('DOB_IN_FUTURE');
  } else if (ageInYears(identity.dateOfBirth, asOf) < MINIMUM_AGE_YEARS) {
    problems.push('UNDER_AGE');
  }

  return describe(problems);
}

/** Whether we hold enough to pay this person. Checked before a payout request. */
export function checkPayoutProfile(profile: PayoutProfile): ProfileCheck {
  const problems: ProfileProblem[] = [];
  const filled = (v: string | null) => typeof v === 'string' && v.trim().length > 0;

  if (
    !filled(profile.addressLine1) ||
    !filled(profile.city) ||
    !filled(profile.postalCode) ||
    !filled(profile.countryCode)
  ) {
    problems.push('ADDRESS_INCOMPLETE');
  }
  if (!filled(profile.phone)) problems.push('PHONE_MISSING');

  return describe(problems);
}

/**
 * True when geographic eligibility can honestly be described as checked.
 *
 * False today, and it must stay false until a restricted-country list is
 * approved: capturing a country is not the same as having decided which
 * countries are acceptable.
 */
export function geographicEligibilityIsEnforceable(): boolean {
  return RESTRICTED_COUNTRIES.status === 'CONFIRMED';
}
