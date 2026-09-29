'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

const DialogContext = createContext(null);

const TONES = {
  neutral: { confirmClass: '', confirmLabel: 'Confirm', title: 'Please confirm' },
  danger: { confirmClass: 'danger', confirmLabel: 'Delete forever', title: 'Are you sure?' },
};

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const panelRef = useRef(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const titleId = useId();
  const bodyId = useId();
  const errorId = useId();

  const settle = useCallback(result => {
    resolver.current?.(result);
    resolver.current = null;
    setRequest(null);
    setValue('');
    setError('');
  }, []);

  const open = useCallback((kind, message, options) => {
    if (resolver.current) resolver.current(kind === 'prompt' ? null : false);
    const config = typeof message === 'string'
      ? { ...(options || {}), message }
      : { ...(message || {}) };
    setValue(config.defaultValue === undefined || config.defaultValue === null ? '' : String(config.defaultValue));
    setError('');
    setRequest({
      kind,
      message: String(config.message ?? '').trim(),
      detail: config.detail ? String(config.detail).trim() : '',
      label: config.label || '',
      placeholder: config.placeholder || '',
      inputMode: config.inputMode || 'text',
      tone: config.tone === 'danger' ? 'danger' : 'neutral',
      confirmLabel: config.confirmLabel,
      cancelLabel: config.cancelLabel,
      validate: config.validate,
    });
    return new Promise(resolve => {
      resolver.current = resolve;
    });
  }, []);

  const confirm = useCallback((message, options) => open('confirm', message, options), [open]);

  const prompt = useCallback((message, options) => open('prompt', message, options), [open]);

  const submit = useCallback(() => {
    if (!request) return;
    if (request.kind === 'prompt' && typeof request.validate === 'function') {
      const message = request.validate(value);
      if (message) {
        setError(message);
        inputRef.current?.focus();
        return;
      }
    }
    settle(request.kind === 'prompt' ? value : true);
  }, [request, settle, value]);

  useEffect(() => {
    if (!request) return undefined;
    const previouslyFocused = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (request.kind === 'prompt') inputRef.current?.focus();
    else confirmRef.current?.focus();

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(request.kind === 'prompt' ? null : false);
        return;
      }
      if (event.key === 'Enter' && request.kind === 'prompt') {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [cancelRef.current, request.kind === 'prompt' ? inputRef.current : null, confirmRef.current].filter(Boolean);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = overflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [request, settle, submit]);

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const tone = TONES[request?.tone] ?? TONES.neutral;
  const isPrompt = request?.kind === 'prompt';

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request ? (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) settle(isPrompt ? null : false);
          }}
        >
          <div
            className={`modal-panel card confirm-panel${request.tone === 'danger' ? ' confirm-danger' : ''}`}
            role={isPrompt ? 'dialog' : 'alertdialog'}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={request.detail || error ? bodyId : undefined}
            tabIndex={-1}
            ref={panelRef}
            onKeyDown={event => {
              if (event.key === 'Enter' && !isPrompt && event.target === panelRef.current) {
                event.preventDefault();
                submit();
              }
            }}
          >
            <div className="modal-header">
              <h2 id={titleId}>{isPrompt ? (request.title || 'Enter a value') : tone.title}</h2>
              <button
                type="button"
                className="secondary modal-close"
                onClick={() => settle(isPrompt ? null : false)}
                aria-label="Cancel"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p id={bodyId} className="confirm-message">{request.message}</p>
              {request.detail ? <p className="muted confirm-detail">{request.detail}</p> : null}
              {isPrompt ? (
                <div className="confirm-field">
                  {request.label ? <label htmlFor="confirm-prompt-input">{request.label}</label> : null}
                  <input
                    id="confirm-prompt-input"
                    ref={inputRef}
                    value={value}
                    inputMode={request.inputMode}
                    placeholder={request.placeholder}
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={event => {
                      setValue(event.target.value);
                      if (error) setError('');
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submit();
                      }
                    }}
                    style={error ? { borderColor: '#C03030' } : undefined}
                  />
                  {error ? <p id={errorId} className="error confirm-error">{error}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="confirm-footer">
              <button type="button" className="secondary" ref={cancelRef} onClick={() => settle(isPrompt ? null : false)}>
                {request.cancelLabel || 'Cancel'}
              </button>
              <button type="button" className={tone.confirmClass} ref={confirmRef} onClick={submit}>
                {request.confirmLabel || (isPrompt ? 'Save' : tone.confirmLabel)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context.confirm;
}

export function usePrompt() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('usePrompt must be used inside ConfirmProvider');
  return context.prompt;
}
