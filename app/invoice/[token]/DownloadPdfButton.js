'use client';

import { useState } from 'react';

export default function DownloadPdfButton({ filename }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleDownload() {
    setLoading(true);
    setError('');
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);
      const element = document.getElementById('invoice-printable');
      if (!element) throw new Error('Invoice content is unavailable');
      // Screen-only chrome must not appear in the PDF.
      const hidden = element.querySelectorAll('.no-print');
      const previousDisplay = Array.from(hidden, node => node.style.display);
      hidden.forEach(node => { node.style.display = 'none'; });

      let canvas;
      try {
        canvas = await html2canvas(element, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          imageTimeout: 15000,
          windowWidth: element.scrollWidth,
          onclone: doc => {
            const cloned = doc.getElementById('invoice-printable');
            if (!cloned) return;
            cloned.style.boxShadow = 'none';
            cloned.style.borderRadius = '0';
            cloned.style.padding = '0';
            cloned.style.margin = '0';
            cloned.style.width = '100%';
            cloned.style.maxWidth = 'none';
            // Freeze every image at its rendered size. html2canvas otherwise
            // re-resolves <img> dimensions from the intrinsic file size, which
            // blows a max-width logo up past the card and crops it.
            cloned.querySelectorAll('img').forEach(img => {
              const rect = img.getBoundingClientRect();
              if (rect.width && rect.height) {
                img.style.width = `${rect.width}px`;
                img.style.height = `${rect.height}px`;
                img.style.maxWidth = 'none';
                img.removeAttribute('srcset');
                img.removeAttribute('sizes');
              }
            });
          },
        });
      } finally {
        hidden.forEach((node, i) => { node.style.display = previousDisplay[i]; });
      }

      const image = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 16;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2;

      // Scale to fit the printable area. Cap by height too, so a long invoice
      // shrinks to one page instead of being sliced across several.
      const ratio = canvas.height / canvas.width;
      let drawWidth = usableWidth;
      let drawHeight = usableWidth * ratio;
      if (drawHeight > usableHeight) {
        drawWidth = usableHeight / ratio;
        drawHeight = usableHeight;
      }
      const offsetX = (pageWidth - drawWidth) / 2;
      const offsetY = (pageHeight - drawHeight) / 2;
      pdf.addImage(image, 'PNG', offsetX, offsetY, drawWidth, drawHeight, undefined, 'FAST');

      const safeName = String(filename || 'invoice.pdf').replace(/[^\w.-]+/g, '_');
      pdf.save(safeName);
    } catch {
      setError('Could not generate PDF. Try the Print button instead.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <button type="button" className="secondary" onClick={handleDownload} disabled={loading} aria-busy={loading}>
        {loading ? 'Generating PDF' : 'Download PDF'}
      </button>
      {error && <span role="alert" style={{ fontSize: 12, color: '#9f2f1d' }}>{error}</span>}
    </div>
  );
}
