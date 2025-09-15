export default function LoaderOverlay() {
  return (
    <div className="loader-overlay" role="dialog" aria-modal="true">
      <div className="loader-wrap" role="status" aria-live="polite" aria-label="Loading">
        <div className="loader">
          <div className="inner one"></div>
          <div className="inner two"></div>
          <div className="inner three"></div>
        </div>
        <div className="loader-label" aria-hidden="true">ЗАГРУЗКА…</div>
      </div>
    </div>
  );
}
