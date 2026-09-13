import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DocNav from './DocNav';
import { DOCS, isDocSlug, loadDoc } from './content';

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
    <main className="wrap pt-12 sm:pt-16">
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <DocNav current={slug} headings={headings} />
        <article className="min-w-0">
          <h1 className="display text-[clamp(2.4rem,4.8vw,3.75rem)]">{doc.title}</h1>
          <div className="prose-ans mt-8 [&_h2]:scroll-mt-28 [&_h3]:scroll-mt-28 [&_li::marker]:text-dim [&_ol]:list-decimal [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>
    </main>
  );
}
