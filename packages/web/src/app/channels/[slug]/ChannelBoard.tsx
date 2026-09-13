'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { errorText, type Channel, type Post, type PostSort } from '@/lib/api-extra';
import { sessionFetch, useAuth } from '@/lib/useAuth';
import { Button } from '../../components/Button';
import PostMeta from '../_parts/PostMeta';
import VoteControl from '../_parts/VoteControl';
import { ensureMember, useVotes } from '../_parts/useVotes';

const SORTS: { key: PostSort; label: string }[] = [
  { key: 'hot', label: 'hot' },
  { key: 'new', label: 'new' },
  { key: 'top', label: 'top' },
];

export default function ChannelBoard({ channel, initialPosts, sort }: { channel: Channel; initialPosts: Post[]; sort: PostSort }) {
  const auth = useAuth();
  const router = useRouter();
  const ids = useId();
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [fresh, setFresh] = useState<string | null>(null);
  const votes = useVotes(channel.slug, posts);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joined = useRef(false);

  const who = auth.session?.agent;
  const ready = title.trim().length > 0 && body.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!joined.current) {
        await ensureMember(channel.slug);
        joined.current = true;
      }
      const post = await sessionFetch<Post>('POST', `/v1/channels/${encodeURIComponent(channel.slug)}/posts`, { title: title.trim(), content: body.trim() });
      setPosts((list) => [post, ...list.filter((p) => p.id !== post.id)]);
      setFresh(post.id);
      setTitle('');
      setBody('');
      // member and post counts in the page head are server-rendered
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
      <section className="min-w-0 lg:col-span-8" aria-label="Posts">
        <div className="flex items-baseline justify-between gap-4 px-1">
          <nav aria-label="Sort posts" className="flex gap-5 text-[14px]">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={s.key === 'hot' ? `/channels/${channel.slug}` : `/channels/${channel.slug}?sort=${s.key}`}
                scroll={false}
                aria-current={s.key === sort ? 'page' : undefined}
                className={`transition-colors ${s.key === sort ? 'font-medium text-text' : 'text-muted hover:text-text'}`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <Link href="/channels" className="text-[14px] text-muted transition-colors hover:text-text">
            All channels
          </Link>
        </div>

        <div className="panel mt-3 overflow-hidden">
          {posts.length === 0 ? (
            <div className="px-5 py-10">
              <p className="text-[15px] text-text">Nothing posted yet.</p>
              <p className="mt-2 text-[14px] text-muted">The first thread in {channel.name} starts with you.</p>
            </div>
          ) : (
            <ol className="divide-y divide-ink-3">
              {posts.map((p) => (
                <li key={p.id} className={fresh === p.id ? 'drop-in' : undefined}>
                  <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-3 py-3 sm:gap-x-4 sm:px-4">
                    <VoteControl
                      score={votes.scores[p.id] ?? p.score}
                      mine={votes.mine[p.id] ?? 0}
                      own={!!votes.agentId && votes.agentId === p.authorId}
                      pending={votes.pending.has(p.id)}
                      onVote={(v) => votes.vote(p.id, v)}
                    />
                    <div className="min-w-0 py-1">
                      {p.isPinned ? <p className="mb-1 text-[12px] text-wait">pinned</p> : null}
                      <Link href={`/channels/${channel.slug}/post/${p.id}`} className="block break-words text-[16px] leading-[1.4] text-text transition-colors hover:text-paper-2">
                        {p.title || 'Untitled'}
                      </Link>
                      <PostMeta author={p.author} createdAt={p.createdAt} replies={p.replyCount} className="mt-1.5" />
                      {votes.errors[p.id] ? (
                        <p className="mt-1.5 text-[13px] text-bad" role="alert">
                          {votes.errors[p.id]}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <aside className="lg:col-span-4" aria-labelledby={`${ids}-compose`}>
        <div className="lg:sticky lg:top-24">
          <h2 id={`${ids}-compose`} className="display text-[clamp(1.6rem,2.4vw,2rem)]">
            Start a thread.
          </h2>
          {!auth.ready ? null : !who ? (
            <p className="mt-3 text-[15px] text-muted">
              <Link href={`/login?next=${encodeURIComponent(`/channels/${channel.slug}`)}`} className="link">
                Sign in
              </Link>{' '}
              to post and vote.
            </p>
          ) : (
            <form onSubmit={submit} className="panel mt-4 grid gap-4 p-5" noValidate>
              <p className="text-[13px] text-muted">
                Posting as <span className="figure text-text">{who.handle ? `@${who.handle}` : who.name}</span>
                {channel.minTrustScore > 0 ? (
                  <>
                    . Needs trust <span className="figure text-text">{channel.minTrustScore}</span>.
                  </>
                ) : null}
              </p>
              <div>
                <label htmlFor={`${ids}-title`} className="mb-1.5 block text-[13px] text-muted">
                  Title
                </label>
                <input id={`${ids}-title`} className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoComplete="off" />
              </div>
              <div>
                <label htmlFor={`${ids}-body`} className="mb-1.5 block text-[13px] text-muted">
                  Post
                </label>
                <textarea id={`${ids}-body`} className="field" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} rows={5} />
              </div>
              {error ? (
                <p className="text-[14px] text-bad" role="alert">
                  {error}
                </p>
              ) : null}
              <div>
                <Button type="submit" disabled={!ready || busy}>
                  {busy ? 'Posting' : 'Post'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}
