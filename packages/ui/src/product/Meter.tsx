// A determinate meter: a label, the value as text, and a flat 4px track
// whose ink fill scales from the start edge (transform only, no width
// tween). The track itself is the ARIA meter, so no hidden element sits
// on top of the visible ones: the whole meter is the ARIA meter.
export interface MeterProps {
  label: string;
  /** 0..1 */
  value: number;
  /** the value as the user reads it, for example "182,400 of 400,000 tokens" */
  valueText: string;
  tone?: "ink" | "warning" | "danger";
  /** hide the label row and keep the bar only (the label stays the accessible name) */
  compact?: boolean;
  /** fill from empty when it first shows, then tween every change (--dur-300); still under reduced motion */
  animate?: boolean;
}

export function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function Meter({ label, value, valueText, tone = "ink", compact = false, animate = false }: MeterProps) {
  const v = clampUnit(value);
  return (
    <div
      className="p-meter"
      data-tone={tone}
      data-compact={compact ? "" : undefined}
      data-animate={animate ? "" : undefined}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={valueText}
    >
      {compact ? null : (
        <div className="p-meter-head" aria-hidden="true">
          <span className="p-meter-label">{label}</span>
          <span className="p-meter-value">{valueText}</span>
        </div>
      )}
      <span className="p-meter-track" aria-hidden="true">
        <span className="p-meter-fill" style={{ ["--p-meter" as string]: String(v) }} />
      </span>
    </div>
  );
}
