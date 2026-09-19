/**
 * ISO 3166-1 alpha-2 country codes.
 *
 * The codes are the data; the display names come from the platform's own
 * Intl.DisplayNames, so they stay correct and localisable without this file
 * carrying 249 English strings that would slowly go stale.
 *
 * The full list is offered deliberately. Truncating it to a "common" subset
 * would silently turn a real customer away with no explanation, and which
 * countries we cannot serve is a legal determination that has not been made —
 * see RESTRICTED_COUNTRIES in ./profile.ts.
 */

const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ ' +
  'BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM ' +
  'DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS ' +
  'GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN ' +
  'KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ ' +
  'MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM ' +
  'PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV ' +
  'SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
  'VN VU WF WS YE YT ZA ZM ZW';

export const COUNTRY_CODES: readonly string[] = Object.freeze(CODES.split(' '));

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

/**
 * Codes paired with names, sorted by name in the caller's locale.
 *
 * A code the runtime cannot name is returned as the bare code rather than
 * dropped: an unnamed option is a cosmetic problem, a missing country is a
 * customer who cannot sign up.
 */
export function countryOptions(locale = 'en'): readonly CountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return COUNTRY_CODES.map((code) => ({
    code,
    name: (() => {
      try {
        return names.of(code) ?? code;
      } catch {
        return code;
      }
    })(),
  })).sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function isKnownCountryCode(code: string): boolean {
  return COUNTRY_CODES.includes(code.trim().toUpperCase());
}
