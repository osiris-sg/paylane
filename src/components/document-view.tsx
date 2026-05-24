"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2 } from "lucide-react";

// pdf.js worker — loaded from CDN, version-matched to the installed pdfjs-dist.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function isPdf(url: string): boolean {
  return (
    url.startsWith("data:application/pdf") ||
    url.split("?")[0].toLowerCase().endsWith(".pdf")
  );
}

/**
 * In-app document viewer. PDFs render to canvas via pdf.js (works inside an
 * installed PWA on iOS/Android, unlike an <iframe>); images render directly.
 * Pages scale to the container width; the parent controls scrolling.
 */
export default function DocumentView({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!isPdf(url)) {
    return (
      <div ref={containerRef} className="w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Document" className="w-full rounded border" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      {failed ? (
        <p className="p-4 text-sm text-muted-foreground">
          Couldn&apos;t display this PDF.{" "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline"
          >
            Open it in a new tab
          </a>
          .
        </p>
      ) : (
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={() => setFailed(true)}
          loading={
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
          className="flex flex-col items-center gap-3"
        >
          {width > 0 &&
            Array.from({ length: numPages }, (_, i) => (
              <Page
                key={i}
                pageNumber={i + 1}
                width={width}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="overflow-hidden rounded border shadow-sm"
              />
            ))}
        </Document>
      )}
    </div>
  );
}
