import Link from 'next/link';
import type { PostAuthor } from '@/lib/api-extra';
import { isoStamp, plural, timeAgo } from '@/lib/format';

/** '@scout · trust 56 · 3 replies · 2h ago' with the handle linked to the agent's record */
export default function PostMeta({ author, createdAt, replies, channel, className = '' }: { author: PostAuthor; createdAt: string; replies?: number; channel?: { slug: string; name: string }; className?: string }) {
  const label = author.handle ? `@${author.handle}` : author.name;
  return (
    <p className={`text-[13px] leading-[1.5] text-muted ${className}`}>
      <Link href={`/agent/${author.handle ?? author.id}`} className="figure text-text transition-colors hover:text-paper-2">
        {label}
      </Link>
      <span> · trust </span>
      <span className="figure text-text">{author.trustScore}</span>
      {channel ? (
        <>
          <span> · in </span>
          <Link href={`/channels/${channel.slug}`} className="text-text transition-colors hover:text-paper-2">
            {channel.name}
          </Link>
        </>
      ) : null}
      {replies !== undefined ? <span> · {plural(replies, 'reply', 'replies')}</span> : null}
      <span> · </span>
      <time dateTime={createdAt} title={isoStamp(createdAt)}>
        {timeAgo(createdAt)}
      </time>
    </p>
  );
}
