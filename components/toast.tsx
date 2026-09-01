"use client";

/**
 * Toasts. `const toast = useToast(); toast.success("Saved")`.
 * Live region so screen readers announce them; auto-dismiss after 4.5 s.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconX } from "@/components/icons";

type Kind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  message: string;
}
interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push]
  );

  const pillClass: Record<Kind, string> = {
    success: "border-success/40 bg-success-soft text-success",
    error: "border-error/40 bg-error-soft text-error",
    info: "border-info/40 bg-info-soft text-info",
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-sm ${pillClass[t.kind]}`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Outside the provider (tests, isolated renders): fall back to console.
    return {
      success: (m) => console.info(m),
      error: (m) => console.error(m),
      info: (m) => console.info(m),
    };
  }
  return ctx;
}
