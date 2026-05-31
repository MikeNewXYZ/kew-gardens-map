import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
// `?url` makes Vite emit the pdf.js worker as a hashed asset and hand us its
// final URL — works in both dev and production builds.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import styles from "./PdfView.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

// Local copy of Kew's official visitor map (public/kew-gardens-map.pdf).
const PDF_FILE = "/kew-gardens-map.pdf";
const DOWNLOAD_NAME = "kew-gardens-map.pdf";

export function PdfView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // Render each page at the container's CSS width; pinch-zoom scales from there.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render above the CSS resolution so detail stays sharp when zoomed in.
  const dpr = Math.min(3, (window.devicePixelRatio || 1) * 1.5);

  if (error) {
    return (
      <div className={styles.wrap} ref={wrapRef}>
        <div className={styles.message}>
          <p>Couldn't load the map.</p>
          <a className={styles.btn} href={PDF_FILE} download={DOWNLOAD_NAME}>
            ⬇ Download PDF
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {!ready && (
        <div className={styles.message}>
          <span className={styles.spinner} aria-hidden />
          Loading map…
        </div>
      )}

      <TransformWrapper
        minScale={1}
        maxScale={8}
        doubleClick={{ mode: "zoomIn", step: 1.2 }}
        wheel={{ step: 0.15 }}
        pinch={{ step: 5 }}
        centerOnInit
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent
              wrapperClass={styles.viewport}
              contentClass={styles.content}
            >
              <Document
                file={PDF_FILE}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                onLoadError={() => setError(true)}
                loading=""
                error={<div className={styles.message}>Couldn't load the map.</div>}
              >
                {width > 0 &&
                  Array.from({ length: numPages }, (_, i) => (
                    <Page
                      key={i}
                      pageNumber={i + 1}
                      width={width}
                      devicePixelRatio={dpr}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      onRenderSuccess={() => setReady(true)}
                      loading=""
                    />
                  ))}
              </Document>
            </TransformComponent>

            {ready && (
              <div className={styles.zoomBar}>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  aria-label="Zoom in"
                  onClick={() => zoomIn()}
                >
                  +
                </button>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  aria-label="Zoom out"
                  onClick={() => zoomOut()}
                >
                  −
                </button>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  aria-label="Reset zoom"
                  onClick={() => resetTransform()}
                >
                  ⤢
                </button>
              </div>
            )}
          </>
        )}
      </TransformWrapper>

      {ready && (
        <a className={styles.download} href={PDF_FILE} download={DOWNLOAD_NAME}>
          ⬇ Download map
        </a>
      )}
    </div>
  );
}
