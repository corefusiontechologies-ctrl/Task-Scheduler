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
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      const image = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageWidth = pageWidth;
      const imageHeight = canvas.height * imageWidth / canvas.width;
      let heightLeft = imageHeight;
      let position = 0;
      pdf.addImage(image, 'PNG', 0, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imageHeight;
        pdf.addPage();
        pdf.addImage(image, 'PNG', 0, position, imageWidth, imageHeight);
        heightLeft -= pageHeight;
      }
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
