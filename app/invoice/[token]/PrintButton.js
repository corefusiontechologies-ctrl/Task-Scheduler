'use client';

export default function PrintButton() {
  return (
    <button type="button" className="secondary" onClick={() => window.print()}>
      Print invoice
    </button>
  );
}
