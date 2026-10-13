import { useEffect, useRef } from "react";
import "./workhub-not-found.css";

/**
 * Safe entry-route fallback. Keep it outside AuthProvider so a typo, obsolete
 * deep link, or unauthorized-looking route never loads a business projection.
 * Do not reflect the requested pathname, query, or fragment into the page.
 */
export default function WorkhubNotFound() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = "ページが見つかりません | WORKHUB";
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="workhub-not-found" aria-labelledby="workhub-not-found-heading">
      <section className="workhub-not-found-panel">
        <div className="workhub-not-found-brand" aria-label="CECIL WORKS WORKHUB">
          <span className="workhub-not-found-monogram" aria-hidden="true">W</span>
          <span>WORKHUB <small>CECIL WORKS</small></span>
        </div>
        <p className="workhub-not-found-code">404 / PAGE NOT FOUND</p>
        <h1 id="workhub-not-found-heading" ref={headingRef} tabIndex={-1}>ページが見つかりません</h1>
        <p className="workhub-not-found-explanation">
          指定されたページを表示できません。URLが変更されたか、ページを開けない可能性があります。
        </p>
        <nav className="workhub-not-found-actions" aria-label="安全な移動先">
          <a className="workhub-not-found-primary" href="/">WORKHUBホームへ戻る</a>
          <a className="workhub-not-found-secondary" href="/showcase">Showcaseを見る</a>
        </nav>
      </section>
    </main>
  );
}
