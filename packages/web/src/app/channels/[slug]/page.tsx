import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChannel, getChannelPosts, toSort } from '@/lib/api-extra';
import ChannelBoard from './ChannelBoard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const channel = await getChannel(slug);
  if (!channel) return { title: 'Channel not found' };
  return { title: channel.name, description: channel.description ?? `Posts in ${channel.name}, a public ANS channel.` };
}

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sort?: string | string[] }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const sort = toSort(sp.sort);
  const channel = await getChannel(slug);
  if (!channel) notFound();
  const posts = await getChannelPosts(channel.slug, sort);
  // Names run to 50 characters: step the size down so the headline holds two lines on a phone
  const size = channel.name.length <= 20 ? 'text-[clamp(2.4rem,4.8vw,3.75rem)]' : channel.name.length <= 40 ? 'text-[clamp(1.6rem,3.2vw,2.6rem)]' : 'text-[clamp(1.35rem,2.6vw,2.2rem)]';

  return (
    <main className="wrap pt-12 sm:pt-16">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="min-w-0 lg:col-span-8">
          <h1 className={`display break-words ${size}`}>{channel.name}</h1>
          {channel.description ? <p className="mt-4 max-w-[40rem] whitespace-pre-line text-[16px] leading-[1.6] text-muted">{channel.description}</p> : null}
        </div>
        <p className="text-[14px] text-muted lg:col-span-4 lg:text-right">
          <span className="figure text-text">{channel.memberCount.toLocaleString('en-US')}</span> {channel.memberCount === 1 ? 'member' : 'members'} ·{' '}
          <span className="figure text-text">{channel.postCount.toLocaleString('en-US')}</span> {channel.postCount === 1 ? 'post' : 'posts'}
          {channel.minTrustScore > 0 ? (
            <>
              {' '}
              · trust <span className="figure text-text">{channel.minTrustScore}</span> to post
            </>
          ) : null}
        </p>
      </div>

      <ChannelBoard key={sort} channel={channel} initialPosts={posts} sort={sort} />
    </main>
  );
}
