'use client';

import { useCallback } from 'react';
import { useToast } from './Toast';

// The async Clipboard API rejects with NotAllowedError when the document is
// not focused (background tab, devtools overlay, some embedded webviews).
// Fall back to the legacy selection-based copy, which only needs a text field.
async function writeToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  if (typeof document === 'undefined' || !document.body) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.width = '1px';
  area.style.height = '1px';
  area.style.padding = '0';
  area.style.border = 'none';
  area.style.outline = 'none';
  area.style.boxShadow = 'none';
  area.style.background = 'transparent';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  document.body.removeChild(area);
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return copied;
}

export function useCopy() {
  const toast = useToast();

  return useCallback(async (text, options = {}) => {
    const { success = 'Link copied to clipboard.', error = 'Could not copy the link. Select it and copy manually.', detail } = options;
    if (!text) {
      toast.error('There is no link to copy yet.');
      return false;
    }
    const copied = await writeToClipboard(text);
    if (copied) toast.success(success, detail);
    else toast.error(error, detail);
    return copied;
  }, [toast]);
}
