'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorText } from '@/lib/api-extra';
import { sessionFetch, useAuth } from '@/lib/useAuth';

type Votable = { id: string; score: number };
type AgentVotes = { agent: string; votes: Record<string, number> };

/**
 * Votes for a set of posts in one channel: the viewer's own votes (GET /votes), live scores,
 * and a vote action that updates at once and settles on the API's numbers. Everything is
 * keyed by the signed-in agent, so signing out or switching agents never shows stale votes.
 */
export function useVotes(slug: string, posts: Votable[]) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname() || `/channels/${slug}`;
  const agentId = auth.session?.agent.id ?? null;

  const [loaded, setLoaded] = useState<AgentVotes | null>(null);
  const [cast, setCast] = useState<AgentVotes | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const busy = useRef(new Set<string>());

  const ids = posts.map((p) => p.id).join(',');

  const mine = useMemo<Record<string, number>>(() => {
    if (!agentId) return {};
    return { ...(loaded?.agent === agentId ? loaded.votes : {}), ...(cast?.agent === agentId ? cast.votes : {}) };
  }, [agentId, loaded, cast]);

  const scores = useMemo<Record<string, number>>(() => Object.fromEntries(posts.map((p) => [p.id, overrides[p.id] ?? p.score])), [posts, overrides]);

  useEffect(() => {
    if (!agentId || !ids) return;
    let alive = true;
    sessionFetch<{ votes?: Record<string, number> }>('GET', `/v1/channels/${encodeURIComponent(slug)}/votes?postIds=${encodeURIComponent(ids)}`)
      .then((r) => {
        if (alive) setLoaded({ agent: agentId, votes: r.votes ?? {} });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [agentId, slug, ids]);

  const vote = useCallback(
    async (postId: string, value: 1 | -1) => {
      if (!agentId) {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      if (busy.current.has(postId)) return;
      busy.current.add(postId);
      setPending(new Set(busy.current));

      const current = mine[postId] ?? 0;
      const next = current === value ? 0 : value;
      const before = scores[postId] ?? 0;
      const record = (v: number) => setCast((c) => ({ agent: agentId, votes: { ...(c?.agent === agentId ? c.votes : {}), [postId]: v } }));

      record(next);
      setOverrides((o) => ({ ...o, [postId]: before + next - current }));
      setErrors((e) => {
        if (!(postId in e)) return e;
        const rest = { ...e };
        delete rest[postId];
        return rest;
      });

      try {
        const res = await sessionFetch<{ score: number; yourVote: number }>('POST', `/v1/channels/${encodeURIComponent(slug)}/posts/${encodeURIComponent(postId)}/vote`, { value: next });
        record(res.yourVote);
        setOverrides((o) => ({ ...o, [postId]: res.score }));
      } catch (err) {
        record(current);
        setOverrides((o) => ({ ...o, [postId]: before }));
        setErrors((e) => ({ ...e, [postId]: err instanceof ApiError && err.status === 401 ? 'Your session ended. Sign in again to vote.' : errorText(err) }));
      } finally {
        busy.current.delete(postId);
        setPending(new Set(busy.current));
      }
    },
    [agentId, mine, scores, pathname, router, slug],
  );

  return { agentId, mine, scores, errors, pending, vote };
}

/** Join before the first post; an agent that is already a member gets 409, which is fine */
export async function ensureMember(slug: string): Promise<void> {
  try {
    await sessionFetch('POST', `/v1/channels/${encodeURIComponent(slug)}/join`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return;
    throw err;
  }
}
