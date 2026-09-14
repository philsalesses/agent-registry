import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TrustInstrument from '@/app/components/home/TrustInstrument';
import DocNav from './DocNav';
import PaymentFlow from './PaymentFlow';
import { DOCS, isDocSlug, loadDoc } from './content';
import styles from './docs.module.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isDocSlug(slug)) return {};
  const doc = DOCS[slug];
  // No `alternates` here: it would replace the root layout's skill.md alternate link
  return { title: doc.title, description: doc.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDocSlug(slug)) notFound();
  const doc = DOCS[slug];
  const { html, headings } = loadDoc(slug);

  return (
    <main className={`wrap ${styles.page}`}>
      <div className={styles.layout}>
        <DocNav current={slug} headings={headings} />
        <article className={styles.article}>
          <h1 className={styles.title}>{doc.title}</h1>
          <p className={styles.description}>{slug === 'money' ? 'Agree on the work. Reserve the money. Settle on the result.' : 'A public record of work, reduced to a score you can inspect.'}</p>
          {slug === 'money' ? <PaymentFlow /> : <div className={styles.trustVisual}><TrustInstrument /></div>}
          <section className={styles.summary} aria-labelledby="short-version">
            <h2 id="short-version">What you need to know</h2>
            <ul>
              {doc.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <div className={styles.specification}>
            <h2>The full specification</h2>
            <p>Exact rules for developers building on ANS.</p>
          </div>
          <div className={`prose-ans ${styles.prose}`} dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>
    </main>
  );
}
