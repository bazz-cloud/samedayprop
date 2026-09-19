'use client';

import { useActionState } from 'react';
import { Callout, Card } from '@/components/ui';
import type { CountryOption } from '@/domain/customer/countries';
import { saveProfile, type ProfileActionState } from './actions';

const INITIAL: ProfileActionState = { error: null, success: null };

interface Current {
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

function Field({
  name,
  label,
  defaultValue,
  autoComplete,
  required,
  hint,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium mb-1">
        {label}
        {!required && <span className="text-fg-subtle font-normal"> (optional)</span>}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue ?? ''}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
      />
      {hint && <p className="text-xs text-fg-subtle mt-1">{hint}</p>}
    </div>
  );
}

export function ProfileForm({
  current,
  countries,
}: {
  current: Current;
  countries: readonly CountryOption[];
}) {
  const [state, action, pending] = useActionState(saveProfile, INITIAL);

  return (
    <Card>
      <form action={action} className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">
          Where we pay you
        </h2>

        {state.error && <Callout tone="danger">{state.error}</Callout>}
        {state.success && <Callout tone="accent">{state.success}</Callout>}

        <Field
          name="addressLine1"
          label="Street address"
          defaultValue={current.addressLine1}
          autoComplete="address-line1"
          required
        />
        <Field
          name="addressLine2"
          label="Apartment, suite, unit"
          defaultValue={current.addressLine2}
          autoComplete="address-line2"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="city"
            label="City"
            defaultValue={current.city}
            autoComplete="address-level2"
            required
          />
          <Field
            name="region"
            label="State or province"
            defaultValue={current.region}
            autoComplete="address-level1"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="postalCode"
            label="Postal code"
            defaultValue={current.postalCode}
            autoComplete="postal-code"
            required
          />
          <div>
            <label htmlFor="countryCode" className="block text-sm font-medium mb-1">
              Country
            </label>
            <select
              id="countryCode"
              name="countryCode"
              defaultValue={current.countryCode ?? ''}
              autoComplete="country"
              required
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
            >
              <option value="" disabled>
                Select a country
              </option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Field
          name="phone"
          label="Contact number"
          defaultValue={current.phone}
          autoComplete="tel"
          required
          hint="Used if there is a problem with a payout. We do not send marketing messages."
        />

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save details'}
        </button>
      </form>
    </Card>
  );
}
