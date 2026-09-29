// Message the CEO cat (JEV: core.composer): one 44px field and Send on one
// row, a reserved status line under it, so the confirmation never moves
// the page. It sits pinned at the foot of the company feed.
import { ProductIcon } from "@mengai/ui/src/product";
import { useId, useState, type FormEvent } from "react";
import { useAction } from "../hooks";

export function MessageBox({ lead, onSend }: { lead: string; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const act = useAction();
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) {
      act.setError(`Write something for ${lead} first.`);
      return;
    }
    setSent(null);
    const ok = await act.run(async () => {
      await onSend(value);
      return true;
    });
    if (ok) {
      setText("");
      setSent(`${lead} got your note and reads it on the next step.`);
    }
  };
  return (
    <form className="message-form" onSubmit={submit} noValidate aria-label={`Message ${lead}`}>
      <div className="field message-field">
        <label htmlFor={`${id}-in`}>Tell {lead}, the CEO</label>
        <div className="message-row">
          <input
            id={`${id}-in`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (act.error) act.setError(null);
              if (sent) setSent(null);
            }}
            placeholder="What should the crew change or check?"
            maxLength={2000}
            autoComplete="off"
            aria-describedby={`${id}-hint`}
            aria-invalid={act.error ? true : undefined}
          />
          <button type="submit" aria-busy={act.busy || undefined}>
            <ProductIcon name="send" size={20} />
            <span>Send</span>
          </button>
        </div>
        <p className="field-hint" id={`${id}-hint`} data-state={act.error ? "error" : sent ? "success" : undefined} aria-live="polite">
          {act.error ?? sent ?? `${lead} runs the company, so your notes go to ${lead} first.`}
        </p>
      </div>
    </form>
  );
}
