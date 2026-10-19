"use client";
import { asset } from "@/lib/basePath";
// Reads the text out of a PDF in the browser (pdf.js), keeping paragraph breaks and headings on their own lines,
// so the knowledge library can split it into cited passages. Nothing is uploaded except the text.

export async function pdfToText(file: File, onPage?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Served as a plain file (copied into public/vendor by next.config.mjs), not bundled
  pdfjs.GlobalWorkerOptions.workerSrc = asset("/vendor/pdf.worker.min.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const lines: string[] = [];
      let line = "";
      let lastY: number | null = null;
      let lastH = 10;
      for (const it of tc.items as any[]) {
        if (typeof it?.str !== "string") continue;
        const y = Array.isArray(it.transform) ? it.transform[5] : null;
        const h = it.height || lastH;
        // A big vertical jump means a new paragraph or heading: keep it as a blank line
        if (y !== null && lastY !== null && Math.abs(lastY - y) > Math.max(h, lastH) * 1.6) {
          if (line.trim()) lines.push(line.trim());
          line = "";
          lines.push("");
        }
        line += it.str;
        if (it.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ""; }
        if (y !== null) lastY = y;
        lastH = h;
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.join("\n"));
      page.cleanup();
      onPage?.(i, doc.numPages);
    }
  } finally {
    task.destroy().catch(() => {});
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
