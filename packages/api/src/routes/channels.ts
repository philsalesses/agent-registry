import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ANS_BLOCK, generateId } from 'ans-core';
import { db } from '../db';
import { channels, channelMemberships, posts, votes, agents, notifications } from '../db/schema';
import { config } from '../config';
import { requireAgent } from '../lib/auth';
import { jsonAns, teach } from '../lib/errors';
import { fireWebhooksForAgent } from './webhooks';

/**
 * Public channels (forums). Writes need an authenticated agent: signed,
 * session or an api key with scope `read` (posting in a forum is a social
 * action, not a receipt or a spend). Trust gates use agents.trust_score.
 */

const app = new Hono();

const auth = requireAgent({ allow: ['signed', 'session', 'apikey'], scopes: ['read'] });

const authorColumns = { id: agents.id, handle: agents.handle, name: agents.name, avatar: agents.avatar, type: agents.type, trustScore: agents.trustScore };

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function channelBySlug(slug: string) {
  const [row] = await db.select().from(channels).where(eq(channels.slug, slug)).limit(1);
  return row ?? null;
}

async function trustScoreOf(agentId: string): Promise<number> {
  const [row] = await db.select({ trustScore: agents.trustScore }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return row?.trustScore ?? 50;
}

function belowMinimum(c: Parameters<typeof teach>[0], required: number, actual: number, agentId: string) {
  return teach(c, 403, 'trust_below_minimum', `This channel requires trust ${required} or higher`, {
    details: { required, actual, profile: `${config.publicWebUrl}/agent/${agentId}` },
    fix: { docs: ANS_BLOCK.docs, url: `${config.publicWebUrl}/docs/trust`, next: 'Trust rises only through countersigned receipts' },
  });
}

/** Hot score: author trust weighs in, time decays, votes shift it (same shape as before). */
function hotScoreFor(authorTrustScore: number, now: number): number {
  return Math.round(authorTrustScore * 10 + now / 100000);
}

// =============================================================================
// Channels
// =============================================================================

// GET /v1/channels?sort=popular|new|name
app.get('/', async (c) => {
  const limit = intQuery(c.req.query('limit'), 50, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);
  const sort = c.req.query('sort') ?? 'popular';
  const orderBy = sort === 'new' ? desc(channels.createdAt) : sort === 'name' ? asc(channels.name) : desc(channels.memberCount);

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(channels).where(eq(channels.isPublic, true)).orderBy(orderBy).limit(limit).offset(offset),
    db.select({ total: count() }).from(channels).where(eq(channels.isPublic, true)),
  ]);
  return jsonAns(c, { channels: rows, total: Number(total), limit, offset });
});

// GET /v1/channels/:slug
app.get('/:slug', async (c) => {
  const channel = await channelBySlug(c.req.param('slug'));
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');
  const [creator] = await db.select({ id: agents.id, handle: agents.handle, name: agents.name, avatar: agents.avatar }).from(agents).where(eq(agents.id, channel.creatorId)).limit(1);
  return jsonAns(c, { ...channel, creator: creator ?? null });
});

const createChannelSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().max(500).optional(),
  icon: z.string().max(200).optional(),
  isPublic: z.boolean().default(true),
  minTrustScore: z.number().int().min(0).max(100).default(0),
});

// POST /v1/channels
app.post('/', auth, async (c) => {
  const agentId = c.get('agent').id;
  const body = createChannelSchema.parse(await c.req.json());

  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug.length < 3) return teach(c, 400, 'validation_error', 'Name must contain at least 3 letters or digits');
  if (await channelBySlug(slug)) return teach(c, 409, 'conflict', 'Channel name already taken', { details: { slug } });

  const channelId = generateId('ch_', 12);
  await db.transaction(async (tx) => {
    await tx.insert(channels).values({
      id: channelId,
      name: body.name,
      slug,
      description: body.description,
      icon: body.icon,
      creatorId: agentId,
      isPublic: body.isPublic,
      minTrustScore: body.minTrustScore,
      memberCount: 1,
    });
    await tx.insert(channelMemberships).values({ id: generateId('mem_', 12), channelId, agentId, role: 'admin' });
  });

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  return jsonAns(c, channel, 201);
});

// POST /v1/channels/:slug/join
app.post('/:slug/join', auth, async (c) => {
  const agentId = c.get('agent').id;
  const channel = await channelBySlug(c.req.param('slug'));
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');

  const [existing] = await db.select({ id: channelMemberships.id }).from(channelMemberships)
    .where(and(eq(channelMemberships.channelId, channel.id), eq(channelMemberships.agentId, agentId))).limit(1);
  if (existing) return teach(c, 409, 'conflict', 'Already a member');

  if (channel.minTrustScore > 0) {
    const score = await trustScoreOf(agentId);
    if (score < channel.minTrustScore) return belowMinimum(c, channel.minTrustScore, score, agentId);
  }

  await db.transaction(async (tx) => {
    await tx.insert(channelMemberships).values({ id: generateId('mem_', 12), channelId: channel.id, agentId, role: 'member' });
    await tx.update(channels).set({ memberCount: sql`${channels.memberCount} + 1` }).where(eq(channels.id, channel.id));
  });
  return jsonAns(c, { success: true, channel: channel.slug });
});

// POST /v1/channels/:slug/leave
app.post('/:slug/leave', auth, async (c) => {
  const agentId = c.get('agent').id;
  const channel = await channelBySlug(c.req.param('slug'));
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');
  if (channel.creatorId === agentId) return teach(c, 400, 'bad_request', 'The creator cannot leave the channel');

  const removed = await db.delete(channelMemberships)
    .where(and(eq(channelMemberships.channelId, channel.id), eq(channelMemberships.agentId, agentId)))
    .returning({ id: channelMemberships.id });
  if (removed.length > 0) {
    await db.update(channels).set({ memberCount: sql`greatest(${channels.memberCount} - 1, 0)` }).where(eq(channels.id, channel.id));
  }
  return jsonAns(c, { success: true, channel: channel.slug });
});

// GET /v1/channels/:slug/members
app.get('/:slug/members', async (c) => {
  const channel = await channelBySlug(c.req.param('slug'));
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');
  const limit = intQuery(c.req.query('limit'), 50, 1, 100);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);

  const members = await db
    .select({ membership: channelMemberships, agent: authorColumns })
    .from(channelMemberships)
    .innerJoin(agents, eq(channelMemberships.agentId, agents.id))
    .where(eq(channelMemberships.channelId, channel.id))
    .orderBy(desc(channelMemberships.joinedAt))
    .limit(limit)
    .offset(offset);

  return jsonAns(c, { members: members.map((m) => ({ ...m.agent, role: m.membership.role, joinedAt: m.membership.joinedAt })) });
});

// =============================================================================
// Posts
// =============================================================================

// GET /v1/channels/:slug/posts?sort=hot|new|top
app.get('/:slug/posts', async (c) => {
  const channel = await channelBySlug(c.req.param('slug'));
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');
  const limit = intQuery(c.req.query('limit'), 25, 1, 50);
  const offset = intQuery(c.req.query('offset'), 0, 0, 100_000);
  const sort = c.req.query('sort') ?? 'hot';
  const orderBy = sort === 'new' ? desc(posts.createdAt) : sort === 'top' ? desc(posts.score) : desc(posts.hotScore);

  const rows = await db
    .select({ post: posts, author: authorColumns })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(and(eq(posts.channelId, channel.id), isNull(posts.parentId), eq(posts.isDeleted, false)))
    .orderBy(desc(posts.isPinned), orderBy)
    .limit(limit)
    .offset(offset);

  return jsonAns(c, { posts: rows.map((r) => ({ ...r.post, author: r.author })), limit, offset, sort });
});

// GET /v1/channels/:slug/posts/:postId
app.get('/:slug/posts/:postId', async (c) => {
  const { slug, postId } = c.req.param();
  const channel = await channelBySlug(slug);
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');

  const [post] = await db
    .select({ post: posts, author: authorColumns })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(and(eq(posts.id, postId), eq(posts.channelId, channel.id)))
    .limit(1);
  if (!post) return teach(c, 404, 'not_found', 'Post not found');

  const replies = await db
    .select({ post: posts, author: authorColumns })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(and(eq(posts.parentId, postId), eq(posts.isDeleted, false)))
    .orderBy(desc(posts.score), desc(posts.createdAt));

  return jsonAns(c, { ...post.post, author: post.author, replies: replies.map((r) => ({ ...r.post, author: r.author })) });
});

const createPostSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(20_000),
  parentId: z.string().max(64).optional(),
});

// POST /v1/channels/:slug/posts
app.post('/:slug/posts', auth, async (c) => {
  const agentId = c.get('agent').id;
  const channel = await channelBySlug(c.req.param('slug'));
  if (!channel) return teach(c, 404, 'not_found', 'Channel not found');
  const body = createPostSchema.parse(await c.req.json());

  if (!channel.allowAnonymous) {
    const [membership] = await db.select({ id: channelMemberships.id }).from(channelMemberships)
      .where(and(eq(channelMemberships.channelId, channel.id), eq(channelMemberships.agentId, agentId))).limit(1);
    if (!membership) return teach(c, 403, 'forbidden', 'Join the channel before posting', { fix: { docs: ANS_BLOCK.docs, next: `POST /v1/channels/${channel.slug}/join` } });
  }

  const authorTrustScore = await trustScoreOf(agentId);
  if (channel.minTrustScore > 0 && authorTrustScore < channel.minTrustScore) {
    return belowMinimum(c, channel.minTrustScore, authorTrustScore, agentId);
  }

  if (!body.parentId && !body.title?.trim()) return teach(c, 400, 'validation_error', 'Title is required for top-level posts');

  let parent: { post: typeof posts.$inferSelect; author: { id: string; name: string } } | null = null;
  if (body.parentId) {
    const [row] = await db
      .select({ post: posts, author: { id: agents.id, name: agents.name } })
      .from(posts)
      .innerJoin(agents, eq(posts.authorId, agents.id))
      .where(and(eq(posts.id, body.parentId), eq(posts.channelId, channel.id)))
      .limit(1);
    if (!row) return teach(c, 404, 'not_found', 'Parent post not found in this channel');
    parent = row;
  }

  const postId = generateId('post_', 12);
  await db.transaction(async (tx) => {
    await tx.insert(posts).values({
      id: postId,
      channelId: channel.id,
      authorId: agentId,
      title: body.title?.trim() ?? '',
      content: body.content,
      parentId: body.parentId ?? null,
      authorTrustScore,
      hotScore: hotScoreFor(authorTrustScore, Date.now()),
    });
    await tx.update(channels).set({ postCount: sql`${channels.postCount} + 1`, updatedAt: new Date() }).where(eq(channels.id, channel.id));
    if (body.parentId) {
      await tx.update(posts).set({ replyCount: sql`${posts.replyCount} + 1` }).where(eq(posts.id, body.parentId));
    }
  });

  const [created] = await db
    .select({ post: posts, author: authorColumns })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(eq(posts.id, postId))
    .limit(1);

  if (parent && parent.post.authorId !== agentId) {
    fireWebhooksForAgent(parent.post.authorId, 'channel.reply', {
      postId,
      parentPostId: parent.post.id,
      channel: { slug: channel.slug, name: channel.name },
      author: created.author,
      content: body.content.slice(0, 200),
      createdAt: created.post.createdAt,
    }, parent.author.name).catch((err) => console.error('[channels] webhook failed:', err instanceof Error ? err.message : err));
  }

  return jsonAns(c, { ...created.post, author: created.author }, 201);
});

// =============================================================================
// Voting
// =============================================================================

const voteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) });

// POST /v1/channels/:slug/posts/:postId/vote {value: 1 | -1 | 0}
app.post('/:slug/posts/:postId/vote', auth, async (c) => {
  const agentId = c.get('agent').id;
  const { slug, postId } = c.req.param();
  const { value } = voteSchema.parse(await c.req.json());

  const [target] = await db
    .select({ post: posts, channel: channels })
    .from(posts)
    .innerJoin(channels, eq(posts.channelId, channels.id))
    .where(and(eq(posts.id, postId), eq(channels.slug, slug)))
    .limit(1);
  if (!target) return teach(c, 404, 'not_found', 'Post not found');
  if (target.post.authorId === agentId) return teach(c, 400, 'bad_request', 'Cannot vote on your own post');

  const [existingVote] = await db.select().from(votes).where(and(eq(votes.postId, postId), eq(votes.agentId, agentId))).limit(1);
  const oldValue = existingVote?.value ?? 0;

  if (value === 0) {
    if (existingVote) await db.delete(votes).where(eq(votes.id, existingVote.id));
  } else if (existingVote) {
    await db.update(votes).set({ value }).where(eq(votes.id, existingVote.id));
  } else {
    await db.insert(votes).values({ id: generateId('vote_', 12), postId, agentId, value });
  }

  const diff = value - oldValue;
  if (diff !== 0) {
    const upvoteDiff = value === 1 ? 1 : oldValue === 1 ? -1 : 0;
    const downvoteDiff = value === -1 ? 1 : oldValue === -1 ? -1 : 0;
    await db.update(posts).set({
      upvotes: sql`${posts.upvotes} + ${upvoteDiff}`,
      downvotes: sql`${posts.downvotes} + ${downvoteDiff}`,
      score: sql`${posts.score} + ${diff}`,
      hotScore: sql`${posts.hotScore} + ${diff * 10}`,
    }).where(eq(posts.id, postId));

    if (value === 1 && oldValue !== 1) {
      const [voter] = await db.select({ name: agents.name, handle: agents.handle }).from(agents).where(eq(agents.id, agentId)).limit(1);
      const voterName = voter?.handle ? `@${voter.handle}` : voter?.name ?? 'An agent';
      await db.insert(notifications).values({
        id: generateId('notif_', 12),
        agentId: target.post.authorId,
        type: 'system',
        payload: { content: `${voterName} upvoted your post "${target.post.title || 'Reply'}"`, postId, channelSlug: slug },
      });
      fireWebhooksForAgent(target.post.authorId, 'upvote.received', {
        postId,
        postTitle: target.post.title || 'Reply',
        channel: { slug, name: target.channel.name },
        voter: { id: agentId, name: voter?.name ?? agentId, handle: voter?.handle ?? null },
      }).catch((err) => console.error('[channels] webhook failed:', err instanceof Error ? err.message : err));
    }
  }

  const [updated] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  return jsonAns(c, { postId, upvotes: updated.upvotes, downvotes: updated.downvotes, score: updated.score, yourVote: value });
});

// GET /v1/channels/:slug/votes?postIds=a,b,c
app.get('/:slug/votes', auth, async (c) => {
  const agentId = c.get('agent').id;
  const postIds = (c.req.query('postIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (postIds.length === 0) return jsonAns(c, { votes: {} });

  const rows = await db.select().from(votes).where(and(eq(votes.agentId, agentId), inArray(votes.postId, postIds)));
  const voteMap: Record<string, number> = {};
  for (const v of rows) voteMap[v.postId] = v.value;
  return jsonAns(c, { votes: voteMap });
});

export default app;
export { app as channelsRouter };
