// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Sheet and Drawer on the native <dialog> top layer: surface, one
// border-strong hairline, the flat ink scrim, never a shadow. Below 640px
// both are a bottom sheet (28 top corners, safe-area bottom). From 640px a
// Sheet centres and a Drawer holds the inline end at full height. Escape
// and the close button always close; a scrim tap closes unless the sheet
// asks for an explicit answer (dismissible false). The role is written out
// (dialog, or alertdialog for a destructive confirmation) so every overlay
// check reads the sheet as the one layer allowed to sit over the page.
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { ProductIcon } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** false for decisions that need an answer: no scrim tap to close */
  dismissible?: boolean;
  /** alertdialog role for destructive confirmations */
  alert?: boolean;
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") {
        try {
          d.showModal();
        } catch {
          d.setAttribute("open", "");
        }
      } else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onDialogClose = () => close.current();
    d.addEventListener("close", onDialogClose);
    return () => d.removeEventListener("close", onDialogClose);
  }, []);
  return ref;
}

function DialogFrame({ kind, open, onClose, title, description, children, footer, dismissible = true, alert = false }: DialogProps & { kind: "sheet" | "drawer" }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  const descId = useId();
  const onScrim = (e: MouseEvent<HTMLDialogElement>) => {
    if (dismissible && e.target === e.currentTarget) onClose();
  };
  return (
    <dialog
      ref={ref}
      className="p-dialog"
      data-kind={kind}
      role={alert ? "alertdialog" : "dialog"}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={onScrim}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault();
      }}
    >
      <div className="p-dialog-head">
        <div className="p-dialog-titles">
          <h2 className="p-dialog-title" id={titleId}>
            {title}
          </h2>
          {description ? (
            <div className="p-dialog-desc" id={descId}>
              {description}
            </div>
          ) : null}
        </div>
        <button type="button" className="p-icon-btn" aria-label="Close" onClick={onClose}>
          <ProductIcon name="close" size={20} />
        </button>
      </div>
      <div className="p-dialog-body">{open ? children : null}</div>
      {footer && open ? <div className="p-dialog-foot">{footer}</div> : null}
    </dialog>
  );
}

export function Sheet(props: DialogProps) {
  return <DialogFrame kind="sheet" {...props} />;
}

export function Drawer(props: DialogProps) {
  return <DialogFrame kind="drawer" {...props} />;
}
