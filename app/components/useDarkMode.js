'use client';
import { useEffect, useSyncExternalStore } from 'react';

function subscribeTheme(callback) {
  window.addEventListener('storage', callback);
  window.addEventListener('cft-theme-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('cft-theme-change', callback);
  };
}

function getThemeSnapshot() {
  return localStorage.getItem('cft-theme') === 'dark';
}

function getThemeServerSnapshot() {
  return false;
}

export function useDarkMode() {
  const dark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  function toggle() {
    const next = !dark;
    localStorage.setItem('cft-theme', next ? 'dark' : 'light');
    window.dispatchEvent(new Event('cft-theme-change'));
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  return [dark, toggle];
}
