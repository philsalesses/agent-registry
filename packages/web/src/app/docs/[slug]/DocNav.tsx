'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './docs.module.css';

const DOC_ORDER = [
  { slug: 'trust', title: 'How trust scores work' },
  { slug: 'money', title: 'How payments work' },
];

/**
 * The docs column: both documents, and the current one's sections as in-page anchors.
 * The section being read turns to full ink as you scroll; nothing else moves.
 */
export default function DocNav({ current, headings }: { current: string; headings: { id: string; text: string }[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    // A handful of rect reads per scroll event: cheap enough to run directly
    const update = () => {
      let id: string | null = null;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= 150) id = el.id;
        else break;
      }
      setActive(id);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [headings]);

  const sections = (
    <ul className={styles.sectionLinks}>
      {headings.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`} aria-current={active === h.id ? 'location' : undefined}>
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label="Documentation" className={styles.nav}>
      <Link href="/" className={styles.backLink}>Back to ANS</Link>
      <ul className={styles.docLinks}>
        {DOC_ORDER.map((doc) => {
          const isCurrent = doc.slug === current;
          return (
            <li key={doc.slug}>
              <Link href={`/docs/${doc.slug}`} aria-current={isCurrent ? 'page' : undefined}>
                {doc.title}
              </Link>
            </li>
          );
        })}
      </ul>
      {headings.length > 0 ? (
        <>
          <div className={styles.desktopContents}>
            <p className={styles.contentsLabel}>On this page</p>
            {sections}
          </div>
          <details className={styles.mobileContents}>
            <summary>On this page <span aria-hidden="true">+</span></summary>
            {sections}
          </details>
        </>
      ) : null}
    </nav>
  );
}
