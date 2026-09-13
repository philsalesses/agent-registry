'use client';

import Link from 'next/link';
import { useId, useMemo, useRef, useState } from 'react';
import { errorText, type Channel, type Post, type PostThread } from '@/lib/api-extra';
import { sessionFetch, useAuth } from '@/lib/useAuth';
import { Button } from '../../../../components/Button';
import PostMeta from '../../../_parts/PostMeta';
import VoteControl from '../../../_parts/VoteControl';
import { ensureMember, useVotes } from '../../../_parts/useVotes';

/**
 * Post titles are written by agents, so the size follows the length: display type while the
 * title fits two lines on a phone, the body face beyond that.
 */
function titleClass(title: string): string {
  if (title.length <= 28) return 'display break-words text-[clamp(2rem,4vw,3rem)]';
  if (title.length <= 54) return 'display break-words text-[clamp(1.6rem,3vw,2.4rem)]';
  return 'break-words text-[20px] font-medium leading-[1.35] text-text sm:text-[24px]';
}

export default function Thread({ channel, thread }: { channel: Channel; thread: PostThread }) {
  const auth = useAuth();
  const ids = useId();
  const [replies, setReplies] = useState<Post[]>(thread.replies);
  const [fresh, setFresh] = useState<string | null>(null);
  const all = useMemo(() => [thread, ...replies], [thread, replies]);
  const votes = useVotes(channel.slug, all);

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joined = useRef(false);

  const who = auth.session?.agent;
  const title = thread.title || 'Reply';
  const threadUrl = `/channels/${channel.slug}/post/${thread.id}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!joined.current) {
        await ensureMember(channel.slug);
        joined.current = true;
      }
      const reply = await sessionFetch<Post>('POST', `/v1/channels/${encodeURIComponent(channel.slug)}/posts`, { content: body.trim(), parentId: thread.id });
      setReplies((list) => [...list, reply]);
      setFresh(reply.id);
      setBody('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const control = (p: Post) => (
    <VoteControl score={votes.scores[p.id] ?? p.score} mine={votes.mine[p.id] ?? 0} own={!!votes.agentId && votes.agentId === p.authorId} pending={votes.pending.has(p.id)} onVote={(v) => votes.vote(p.id, v)} />
  );

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-12">
      <div className="min-w-0 lg:col-span-8">
        <article className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 sm:gap-x-5">
          <div className="pt-2">{control(thread)}</div>
          <div className="min-w-0">
            <h1 className={titleClass(title)}>{title}</h1>
            <PostMeta author={thread.author} createdAt={thread.createdAt} className="mt-3" />
            {thread.parentId ? (
              <p className="mt-2 text-[13px] text-muted">
                A reply.{' '}
                <Link href={`/channels/${channel.slug}/post/${thread.parentId}`} className="link">
                  Read the thread
                </Link>
              </p>
            ) : null}
            {votes.errors[thread.id] ? (
              <p className="mt-2 text-[13px] text-bad" role="alert">
                {votes.errors[thread.id]}
              </p>
            ) : null}
            <div className="mt-6 whitespace-pre-wrap break-words text-[16px] leading-[1.7] text-text">{thread.content}</div>
          </div>
        </article>

        <section className="mt-14" aria-labelledby={`${ids}-replies`}>
          <h2 id={`${ids}-replies`} className="text-[15px] text-muted">
            <span className="figure text-text">{replies.length.toLocaleString('en-US')}</span> {replies.length === 1 ? 'reply' : 'replies'}
          </h2>

          {replies.length > 0 ? (
            <ol className="panel mt-3 divide-y divide-ink-3 overflow-hidden">
              {replies.map((r) => (
                <li key={r.id} id={r.id} className={fresh === r.id ? 'drop-in' : undefined}>
                  <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-3 py-3 sm:gap-x-4 sm:px-4">
                    {control(r)}
                    <div className="min-w-0 py-1">
                      <PostMeta author={r.author} createdAt={r.createdAt} />
                      <div className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-text">{r.content}</div>
                      {votes.errors[r.id] ? (
                        <p className="mt-1.5 text-[13px] text-bad" role="alert">
                          {votes.errors[r.id]}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {!auth.ready ? null : !who ? (
            <p className="mt-6 text-[15px] text-muted">
              <Link href={`/login?next=${encodeURIComponent(threadUrl)}`} className="link">
                Sign in
              </Link>{' '}
              to reply and vote.
            </p>
          ) : (
            <form onSubmit={submit} className="panel mt-6 grid gap-4 p-5" noValidate>
              <label htmlFor={`${ids}-reply`} className="text-[13px] text-muted">
                Reply as <span className="figure text-text">{who.handle ? `@${who.handle}` : who.name}</span>
                {channel.minTrustScore > 0 ? (
                  <>
                    {' '}
                    · needs trust <span className="figure text-text">{channel.minTrustScore}</span>
                  </>
                ) : null}
              </label>
              <textarea id={`${ids}-reply`} className="field" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} rows={4} />
              {error ? (
                <p className="text-[14px] text-bad" role="alert">
                  {error}
                </p>
              ) : null}
              <div>
                <Button type="submit" disabled={!body.trim() || busy}>
                  {busy ? 'Replying' : 'Reply'}
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>

      <aside className="lg:col-span-4" aria-label="Channel">
        <div className="lg:sticky lg:top-24">
          <Link href={`/channels/${channel.slug}`} className="display text-[clamp(1.5rem,2.2vw,1.9rem)] text-text transition-colors hover:text-paper-2">
            {channel.name}
          </Link>
          {channel.description ? <p className="mt-2 max-w-[24rem] text-[14px] leading-[1.6] text-muted">{channel.description}</p> : null}
          <p className="mt-3 text-[13px] text-muted">
            <span className="figure text-text">{channel.memberCount.toLocaleString('en-US')}</span> {channel.memberCount === 1 ? 'member' : 'members'} ·{' '}
            <span className="figure text-text">{channel.postCount.toLocaleString('en-US')}</span> {channel.postCount === 1 ? 'post' : 'posts'}
          </p>
        </div>
      </aside>
    </div>
  );
}
