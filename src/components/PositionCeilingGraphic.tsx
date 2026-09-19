/**
 * One mini = 10 micros, under one shared ceiling.
 *
 * The misreading this exists to prevent: that "4 minis or 40 micros" is two
 * separate allowances rather than one. Showing both stacked against the same
 * bar makes the shared ceiling obvious in a way the sentence does not.
 */
export function PositionCeilingGraphic({
  minis,
  micros,
}: {
  minis: number;
  micros: number;
}) {
  return (
    <figure className="rounded-xl border border-border bg-surface p-4">
      <div className="space-y-3">
        <div>
          <p className="no-caps text-xs text-fg-subtle mb-1.5">{minis} minis</p>
          <div className="flex gap-1">
            {Array.from({ length: minis }, (_, i) => (
              <div
                key={i}
                className="h-7 flex-1 rounded bg-accent grid place-items-center text-[10px] font-bold text-bg"
              >
                10
              </div>
            ))}
          </div>
        </div>

        <p className="no-caps text-center text-xs font-bold text-fg-subtle">or any mix of</p>

        <div>
          <p className="no-caps text-xs text-fg-subtle mb-1.5">{micros} micros</p>
          <div className="flex gap-0.5">
            {Array.from({ length: micros }, (_, i) => (
              <div key={i} className="h-7 flex-1 rounded-sm bg-accent/35" />
            ))}
          </div>
        </div>

        <div className="border-t border-border-strong pt-2.5">
          <p className="no-caps text-sm">
            <span className="font-bold text-fg">One ceiling of {micros} units.</span>{' '}
            <span className="text-fg-muted">Not {minis} plus {micros}.</span>
          </p>
        </div>
      </div>
    </figure>
  );
}
