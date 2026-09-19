/**
 * Where you are in checkout.
 *
 * The site already refuses to charge before the agreements are signed, which is
 * a genuine protection and was completely invisible — a visitor could not tell
 * this apart from a checkout that takes the card first and shows the terms
 * afterwards. Showing the order is the point of the component.
 */
export function CheckoutSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Your details', 'Sign the agreements', 'Pay'] as const;

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Checkout progress">
      {steps.map((step, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        return (
          <li key={step} className="flex items-center gap-3">
            <span
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                active
                  ? 'border-accent bg-accent text-black'
                  : done
                    ? 'border-accent text-accent'
                    : 'border-border-bold text-fg-disabled'
              }`}
            >
              <span aria-hidden="true" className="tnum">
                {done ? '✓' : number}
              </span>
              <span className="uppercase tracking-wide">{step}</span>
              {active && <span className="sr-only">(current step)</span>}
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="hidden h-px w-6 bg-border-bold sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
