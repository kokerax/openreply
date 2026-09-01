"use client";

/**
 * Accessible confirm dialog replacing window.confirm().
 * `const confirm = useConfirm(); if (await confirm({ title, description, danger: true })) ...`
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>((o) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (opts && !d.open) {
      d.showModal();
      // Destructive actions land focus on Cancel so Enter can't delete by
      // accident; ordinary confirmations focus the primary action.
      window.setTimeout(
        () => (opts.danger ? cancelBtn.current : confirmBtn.current)?.focus(),
        0
      );
    } else if (!opts && d.open) {
      d.close();
    }
  }, [opts]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <dialog
        ref={dialogRef}
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) finish(false);
        }}
        className="m-auto w-[min(92vw,26rem)] rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
      >
        {opts && (
          <div className="p-5">
            <h2 className="text-base font-semibold">{opts.title}</h2>
            {opts.description && (
              <p className="mt-2 text-sm text-muted">{opts.description}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelBtn}
                type="button"
                className="btn btn-secondary"
                onClick={() => finish(false)}
              >
                {opts.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmBtn}
                type="button"
                className={`btn ${opts.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => finish(true)}
              >
                {opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return async (o) =>
      typeof window !== "undefined" ? window.confirm(o.title) : false;
  }
  return ctx;
}
