'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
const MAX_VISIBLE = 4;
const DISMISS_MS = { success: 4000, info: 5000, error: 8000 };

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const hoverCounts = useRef(new Map());
  const toastsRef = useRef([]);

  const clearTimer = useCallback(id => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(id => {
    clearTimer(id);
    hoverCounts.current.delete(id);
    setToasts(current => current.filter(toast => toast.id !== id));
  }, [clearTimer]);

  const schedule = useCallback((id, variant) => {
    clearTimer(id);
    const timer = setTimeout(() => {
      timers.current.delete(id);
      hoverCounts.current.delete(id);
      setToasts(current => current.filter(toast => toast.id !== id));
    }, DISMISS_MS[variant] ?? DISMISS_MS.info);
    timers.current.set(id, timer);
  }, [clearTimer]);

  const push = useCallback((variant, message, detail) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    nextId += 1;
    const id = nextId;
    const body = detail ? String(detail).trim() : '';
    // Duplicate detection reads current state rather than doing it inside the
    // updater, so the updater stays pure (React StrictMode invokes it twice).
    const duplicate = toastsRef.current.find(toast => toast.message === text && toast.variant === variant);
    if (duplicate) {
      schedule(duplicate.id, variant);
      setToasts(current => current.map(toast => (toast.id === duplicate.id ? { ...toast, detail: body } : toast)));
      return;
    }
    setToasts(current => {
      const next = [...current, { id, variant, message: text, detail: body }];
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
    schedule(id, variant);
  }, [schedule]);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  // Clear timers for toasts that are no longer rendered, which covers both the
  // MAX_VISIBLE trim and unmount.
  useEffect(() => {
    const live = new Set(toasts.map(toast => toast.id));
    for (const id of [...timers.current.keys()]) {
      if (live.has(id)) continue;
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      hoverCounts.current.delete(id);
    }
  }, [toasts]);

  useEffect(() => {
    const store = timers.current;
    return () => {
      store.forEach(timer => clearTimeout(timer));
      store.clear();
    };
  }, []);

  const api = useMemo(() => ({
    success: (message, detail) => push('success', message, detail),
    error: (message, detail) => push('error', message, detail),
    info: (message, detail) => push('info', message, detail),
    dismiss,
  }), [push, dismiss]);

  const hold = id => {
    clearTimer(id);
    hoverCounts.current.set(id, (hoverCounts.current.get(id) || 0) + 1);
  };

  const release = id => {
    const count = (hoverCounts.current.get(id) || 1) - 1;
    if (count > 0) {
      hoverCounts.current.set(id, count);
      return;
    }
    hoverCounts.current.delete(id);
    const toast = toasts.find(item => item.id === id);
    if (toast) schedule(id, toast.variant);
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions text">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast toast-${toast.variant}`}
            role={toast.variant === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => hold(toast.id)}
            onMouseLeave={() => release(toast.id)}
            onFocus={() => hold(toast.id)}
            onBlur={() => release(toast.id)}
          >
            <div className="toast-body">
              <p className="toast-message">{toast.message}</p>
              {toast.detail ? <p className="toast-detail">{toast.detail}</p> : null}
            </div>
            <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
