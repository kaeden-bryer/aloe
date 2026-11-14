/**
 * App-wide toast. Any component calls `useToast()("Saved")`; the provider
 * renders one message at a time and hides it after 2.8 s, like the design.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // useCallback keeps `flash` stable, so effects that depend on it don't re-run.
  const flash = useCallback((msg: string) => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2800);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={flash}>
      {children}
      {message && (
        <div role="status" className="toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8FD1A6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
