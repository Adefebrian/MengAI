// Layout pieces every app screen shares, on the JAL Core anatomy: the page
// wrapper (one rhythm for every screen), the page head, a region head, the
// card, and form fields (label above, 44px control, a reserved helper or
// error slot, so validation never shifts a row).
import { ProductIcon, type GlyphName } from "@mengai/ui/src/product";
import { useAppMaybe } from "./context";
import { useId, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** The one page wrapper inside the contained shell: 1280 cap, one gap between regions. */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const app = useAppMaybe();
  return (
    <div className="app-page" data-wide={wide ? "" : undefined}>
      {app?.notices}
      {children}
    </div>
  );
}

export function PageHead({ title, lead, actions, titleAttr, meta }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; titleAttr?: string; meta?: ReactNode }) {
  return (
    <header className="app-head" data-actions={actions ? "" : undefined}>
      <div className="app-head-text">
        <h1 className="app-title" title={titleAttr}>
          {title}
        </h1>
        {meta ? <div className="app-head-meta">{meta}</div> : null}
        {lead ? <p className="app-lead">{lead}</p> : null}
      </div>
      {actions ? <div className="app-head-actions">{actions}</div> : null}
    </header>
  );
}

/** The screen title for assistive tech when JEV dropped the visible page head. */
export function ScreenTitle({ children }: { children: string }) {
  return (
    <div className="p-sr-wrap">
      <h1 className="p-sr-only">{children}</h1>
    </div>
  );
}

export function RegionHead({ title, meta, actions, id, level = 2 }: { title: string; meta?: ReactNode; actions?: ReactNode; id?: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="app-region-head" data-actions={actions ? "" : undefined}>
      <div className="app-region-text">
        <H className="app-h2" id={id}>
          {title}
        </H>
        {meta ? <p className="app-region-meta">{meta}</p> : null}
      </div>
      {actions ? <div className="app-region-actions">{actions}</div> : null}
    </div>
  );
}

type Container = "rows" | "card" | "divided" | "plain" | "bento";

/**
 * One region of a screen in the container JEV picked. The container is a
 * data attribute so the CSS draws exactly one boundary per region.
 */
export function Region({
  container,
  title,
  meta,
  actions,
  children,
  id,
  labelId,
  className,
  hideHead,
}: {
  container: Container;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  labelId?: string;
  className?: string;
  hideHead?: boolean;
}) {
  const auto = useId();
  const hid = labelId ?? `${auto}-h`;
  return (
    <section
      className={["app-region", className].filter(Boolean).join(" ")}
      data-container={container}
      aria-labelledby={hideHead ? undefined : hid}
      aria-label={hideHead ? title : undefined}
      id={id}
    >
      {hideHead ? null : <RegionHead title={title} meta={meta} actions={actions} id={hid} />}
      {children}
    </section>
  );
}

export function IconLabel({ icon, children }: { icon: GlyphName; children: ReactNode }) {
  return (
    <>
      <ProductIcon name={icon} size={20} />
      <span>{children}</span>
    </>
  );
}

interface FieldShell {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

function Hint({ id, hint, error }: { id: string; hint?: ReactNode; error?: string | null }) {
  return (
    <p className="field-hint" id={id} data-state={error ? "error" : undefined} aria-live={error ? "polite" : undefined}>
      {error ?? hint ?? ""}
    </p>
  );
}

export function TextField({ label, hint, error, id, ref, ...input }: FieldShell & InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  const hid = `${fid}-hint`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <input ref={ref} id={fid} aria-describedby={hid} aria-invalid={error ? true : undefined} {...input} />
      <Hint id={hid} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({ label, hint, error, id, ref, ...input }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  const hid = `${fid}-hint`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <textarea ref={ref} id={fid} aria-describedby={hid} aria-invalid={error ? true : undefined} {...input} />
      <Hint id={hid} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({ label, hint, error, id, children, ...select }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const hid = `${fid}-hint`;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <select id={fid} aria-describedby={hid} aria-invalid={error ? true : undefined} {...select}>
        {children}
      </select>
      <Hint id={hid} hint={hint} error={error} />
    </div>
  );
}

/**
 * A segmented choice (JAL Core segmented button, the R13 tonal track): one
 * radio group of 44px segments on a layer-1 track, the chosen one on a
 * surface fill in ink at weight 600. Arrow keys move and select, one tab
 * stop. Built from buttons so no hidden input sits on a visible one.
 */
export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  showLegend,
}: {
  legend: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  showLegend?: boolean;
}) {
  const lid = useId();
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(index + step + options.length) % options.length]!;
    onChange(next.value);
    const group = e.currentTarget.parentElement;
    requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus());
  };
  return (
    <div className="app-choice">
      {showLegend ? (
        <p className="field-label" id={lid}>
          {legend}
        </p>
      ) : null}
      <div className="app-seg" role="radiogroup" aria-labelledby={showLegend ? lid : undefined} aria-label={showLegend ? undefined : legend} data-name={name}>
        {options.map((o, i) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-value={o.value}
              className="app-seg-item"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => move(e, i)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A switch (JAL Core Switch): the whole row is one 44px button with role switch; the thumb moves by transform. */
export function Switch({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="app-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="app-switch-track" aria-hidden="true">
        <span className="app-switch-thumb" />
      </span>
      <span className="app-switch-text">
        <span className="app-switch-label">{label}</span>
        {description ? <span className="app-switch-desc">{description}</span> : null}
      </span>
    </button>
  );
}

export function Checkbox({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="jal-checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {description ? <span data-slot="description">{description}</span> : null}
      </span>
    </label>
  );
}

/** Inline result line under a form: the changed state itself, or the error with its cause. Space is reserved. */
export function FormStatus({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (!ok && !error) return <p className="app-form-status" aria-live="polite" />;
  return (
    <p className="app-form-status" data-tone={error ? "danger" : "success"} aria-live="polite">
      <ProductIcon name={error ? "alertCircle" : "checkCircle"} size={16} />
      <span>{error ?? ok}</span>
    </p>
  );
}

/** A figure in tabular mono with its unit at the meta size. */
export function Figure({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="app-figure">
      <span className="app-figure-value">{value}</span>
      {unit ? <span className="app-figure-unit">{" "}{unit}</span> : null}
    </span>
  );
}
