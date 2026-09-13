'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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

  return (
    <nav aria-label="Docs" className="order-last lg:order-none lg:sticky lg:top-24 lg:self-start">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 lg:grid lg:gap-5">
        {DOC_ORDER.map((doc) => {
          const isCurrent = doc.slug === current;
          return (
            <li key={doc.slug}>
              <Link href={`/docs/${doc.slug}`} aria-current={isCurrent ? 'page' : undefined} className={`text-[15px] transition-colors ${isCurrent ? 'font-medium text-text' : 'text-muted hover:text-text'}`}>
                {doc.title}
              </Link>
              {isCurrent && headings.length > 0 ? (
                <ul className="mt-3 hidden gap-2.5 pl-3 lg:grid">
                  {headings.map((h) => (
                    <li key={h.id}>
                      <a
                        href={`#${h.id}`}
                        aria-current={active === h.id ? 'location' : undefined}
                        className={`block text-[13px] leading-[1.45] transition-colors ${active === h.id ? 'text-text' : 'text-muted hover:text-text'}`}
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
