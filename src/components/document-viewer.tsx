"use client";

import React from "react";
import dynamic from "next/dynamic";

// The pdf.js-based viewer is heavy and client-only; load it lazily.
const DocumentView = dynamic(() => import("~/components/document-view"), {
  ssr: false,
  loading: () => (
    <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
  ),
});

class ViewerBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // pdf.js fails to evaluate under `next dev` (webpack eval-wraps its 3MB
    // bundle); it works in production. Either way, never take the page down.
    console.error("DocumentView failed to render:", error);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/**
 * Renders the in-app PDF/image preview, but isolates any pdf.js failure so it
 * can never crash the whole page — falling back to an "open in new tab" link.
 */
export function DocumentViewer({ url }: { url: string }) {
  return (
    <ViewerBoundary
      fallback={
        <div className="rounded border bg-muted/30 p-4 text-sm text-muted-foreground">
          Couldn&apos;t render the preview here.{" "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 underline"
          >
            Open it in a new tab
          </a>
          .
        </div>
      }
    >
      <DocumentView url={url} />
    </ViewerBoundary>
  );
}
