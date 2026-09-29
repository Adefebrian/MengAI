// One flat stacked bar (JAL Core Progress, stacked): each segment is a
// share of the total, drawn as a flat block with a 2px surface gap, never a
// gradient. Two neutral tones only, "strong" and "soft"; their meaning is
// always said in words beside the bar, never by color alone. The native
// description list below the bar is the accessible reading.
export interface StackedSegment {
  key: string;
  label: string;
  value: number;
  tone: "strong" | "soft";
}

export interface StackedBarProps {
  label: string;
  segments: StackedSegment[];
  /** the scale of the bar; the rest of the track stays empty */
  total: number;
  /** a one line reading of the bar for assistive tech */
  valueText: string;
}

export function StackedBar({ label, segments, total, valueText }: StackedBarProps) {
  const scale = Math.max(total, segments.reduce((s, x) => s + Math.max(0, x.value), 0), 1);
  const used = segments.filter((s) => s.value > 0);
  const rest = Math.max(0, scale - used.reduce((s, x) => s + x.value, 0));
  return (
    <div className="p-stack" role="img" aria-label={`${label}: ${valueText}`}>
      <span className="p-stack-track" aria-hidden="true">
        {used.map((s) => (
          <span key={s.key} className="p-stack-seg" data-tone={s.tone} style={{ flexGrow: s.value }} title={`${s.label}: ${s.value}`} />
        ))}
        {rest > 0 ? <span className="p-stack-rest" style={{ flexGrow: rest }} /> : null}
      </span>
    </div>
  );
}
