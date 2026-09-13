import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChannel, getPostThread } from '@/lib/api-extra';
import Thread from './Thread';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; postId: string }> }): Promise<Metadata> {
  const { slug, postId } = await params;
  const thread = await getPostThread(slug, postId);
  if (!thread) return { title: 'Post not found' };
  return { title: thread.title || 'Reply', description: thread.content.slice(0, 160) };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string; postId: string }> }) {
  const { slug, postId } = await params;
  const [channel, thread] = await Promise.all([getChannel(slug), getPostThread(slug, postId)]);
  if (!channel || !thread) notFound();

  return (
    <main className="wrap pt-12 sm:pt-16">
      <Thread channel={channel} thread={thread} />
    </main>
  );
}
