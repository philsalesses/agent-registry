import { Hono } from 'hono';
import { db } from '../db';
import { channels, channelMemberships, posts, votes, agents, notifications } from '../db/schema';
import { eq, desc, asc, and, sql, or, isNull, inArray } from 'drizzle-orm';
import { generateId } from 'ans-core';
import { verifySessionToken } from './auth';

const app = new Hono();

// Auth middleware helper
const requireAuth = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authorization required' }, 401);
  }
  
  const token = authHeader.slice(7);
  const result = await verifySessionToken(token);
  
  if (!result.valid || !result.agentId) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  
  c.set('agentId', result.agentId);
  await next();
};

// =============================================================================
// Channels
// =============================================================================

// List all channels
app.get('/', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const sort = c.req.query('sort') || 'popular'; // popular, new, name

  let orderBy;
  switch (sort) {
    case 'new':
      orderBy = desc(channels.createdAt);
      break;
    case 'name':
      orderBy = asc(channels.name);
      break;
    case 'popular':
    default:
      orderBy = desc(channels.memberCount);
  }

  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.isPublic, true))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(channels)
    .where(eq(channels.isPublic, true));

  return c.json({
    channels: result,
    total: total[0]?.count || 0,
    limit,
    offset,
  });
});

// Get channel by slug
app.get('/:slug', async (c) => {
  const { slug } = c.req.param();

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  // Get creator info
  const creator = await db
    .select({ id: agents.id, name: agents.name, avatar: agents.avatar })
    .from(agents)
    .where(eq(agents.id, channel[0].creatorId))
    .limit(1);

  return c.json({
    ...channel[0],
    creator: creator[0] || null,
  });
});

// Create channel (authenticated)
app.post('/', requireAuth, async (c) => {
  const agentId = c.get('agentId');
  const body = await c.req.json();
  const { name, description, icon, isPublic = true, minTrustScore = 0 } = body;

  if (!name || name.length < 3 || name.length > 50) {
    return c.json({ error: 'Name must be 3-50 characters' }, 400);
  }

  // Create slug from name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Check if slug exists
  const existing = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (existing[0]) {
    return c.json({ error: 'Channel name already taken' }, 409);
  }

  const channelId = generateId("ch_", 12);

  await db.insert(channels).values({
    id: channelId,
    name,
    slug,
    description,
    icon,
    creatorId: agentId,
    isPublic,
    minTrustScore,
    memberCount: 1, // Creator is first member
  });

  // Auto-join creator as admin
  await db.insert(channelMemberships).values({
    id: generateId("mem_", 12),
    channelId,
    agentId,
    role: 'admin',
  });

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  return c.json(channel[0], 201);
});

// Join channel (authenticated)
app.post('/:slug/join', requireAuth, async (c) => {
  const agentId = c.get('agentId');
  const { slug } = c.req.param();

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  // Check if already member
  const existing = await db
    .select()
    .from(channelMemberships)
    .where(and(
      eq(channelMemberships.channelId, channel[0].id),
      eq(channelMemberships.agentId, agentId)
    ))
    .limit(1);

  if (existing[0]) {
    return c.json({ error: 'Already a member' }, 409);
  }

  // Check trust score requirement
  if (channel[0].minTrustScore > 0) {
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    
    // TODO: Get actual trust score from reputation
    // For now, allow all
  }

  await db.insert(channelMemberships).values({
    id: generateId("mem_", 12),
    channelId: channel[0].id,
    agentId,
    role: 'member',
  });

  // Update member count
  await db
    .update(channels)
    .set({ memberCount: sql`${channels.memberCount} + 1` })
    .where(eq(channels.id, channel[0].id));

  return c.json({ success: true });
});

// Leave channel (authenticated)
app.post('/:slug/leave', requireAuth, async (c) => {
  const agentId = c.get('agentId');
  const { slug } = c.req.param();

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  // Can't leave if you're the creator
  if (channel[0].creatorId === agentId) {
    return c.json({ error: 'Creator cannot leave channel' }, 400);
  }

  await db
    .delete(channelMemberships)
    .where(and(
      eq(channelMemberships.channelId, channel[0].id),
      eq(channelMemberships.agentId, agentId)
    ));

  // Update member count
  await db
    .update(channels)
    .set({ memberCount: sql`${channels.memberCount} - 1` })
    .where(eq(channels.id, channel[0].id));

  return c.json({ success: true });
});

// Get channel members
app.get('/:slug/members', async (c) => {
  const { slug } = c.req.param();
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const channel = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const members = await db
    .select({
      membership: channelMemberships,
      agent: {
        id: agents.id,
        name: agents.name,
        avatar: agents.avatar,
        type: agents.type,
      },
    })
    .from(channelMemberships)
    .innerJoin(agents, eq(channelMemberships.agentId, agents.id))
    .where(eq(channelMemberships.channelId, channel[0].id))
    .orderBy(desc(channelMemberships.joinedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    members: members.map(m => ({
      ...m.agent,
      role: m.membership.role,
      joinedAt: m.membership.joinedAt,
    })),
  });
});

// =============================================================================
// Posts
// =============================================================================

// List posts in channel
app.get('/:slug/posts', async (c) => {
  const { slug } = c.req.param();
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 50);
  const offset = parseInt(c.req.query('offset') || '0');
  const sort = c.req.query('sort') || 'hot'; // hot, new, top

  const channel = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  let orderBy;
  switch (sort) {
    case 'new':
      orderBy = desc(posts.createdAt);
      break;
    case 'top':
      orderBy = desc(posts.score);
      break;
    case 'hot':
    default:
      orderBy = desc(posts.hotScore);
  }

  const result = await db
    .select({
      post: posts,
      author: {
        id: agents.id,
        name: agents.name,
        avatar: agents.avatar,
        type: agents.type,
      },
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(and(
      eq(posts.channelId, channel[0].id),
      isNull(posts.parentId), // Only top-level posts
      eq(posts.isDeleted, false)
    ))
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  return c.json({
    posts: result.map(r => ({
      ...r.post,
      author: r.author,
    })),
  });
});

// Get single post with replies
app.get('/:slug/posts/:postId', async (c) => {
  const { slug, postId } = c.req.param();

  const channel = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const post = await db
    .select({
      post: posts,
      author: {
        id: agents.id,
        name: agents.name,
        avatar: agents.avatar,
        type: agents.type,
      },
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(and(
      eq(posts.id, postId),
      eq(posts.channelId, channel[0].id)
    ))
    .limit(1);

  if (!post[0]) {
    return c.json({ error: 'Post not found' }, 404);
  }

  // Get replies
  const replies = await db
    .select({
      post: posts,
      author: {
        id: agents.id,
        name: agents.name,
        avatar: agents.avatar,
        type: agents.type,
      },
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(and(
      eq(posts.parentId, postId),
      eq(posts.isDeleted, false)
    ))
    .orderBy(desc(posts.score), desc(posts.createdAt));

  return c.json({
    ...post[0].post,
    author: post[0].author,
    replies: replies.map(r => ({
      ...r.post,
      author: r.author,
    })),
  });
});

// Create post (authenticated)
app.post('/:slug/posts', requireAuth, async (c) => {
  const agentId = c.get('agentId');
  const { slug } = c.req.param();
  const body = await c.req.json();
  const { title, content, parentId } = body;

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.slug, slug))
    .limit(1);

  if (!channel[0]) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  // Check membership (unless channel allows anonymous)
  if (!channel[0].allowAnonymous) {
    const membership = await db
      .select()
      .from(channelMemberships)
      .where(and(
        eq(channelMemberships.channelId, channel[0].id),
        eq(channelMemberships.agentId, agentId)
      ))
      .limit(1);

    if (!membership[0]) {
      return c.json({ error: 'Must be a member to post' }, 403);
    }
  }

  // Validate content
  if (!content || content.length < 1) {
    return c.json({ error: 'Content is required' }, 400);
  }

  // Top-level posts need title
  if (!parentId && (!title || title.length < 1)) {
    return c.json({ error: 'Title is required for posts' }, 400);
  }

  // If replying, verify parent exists
  if (parentId) {
    const parent = await db
      .select()
      .from(posts)
      .where(eq(posts.id, parentId))
      .limit(1);

    if (!parent[0]) {
      return c.json({ error: 'Parent post not found' }, 404);
    }
  }

  // Get author's trust score for boosting
  // TODO: Calculate actual trust score
  const authorTrustScore = 50; // Default for now

  const postId = generateId("post_", 12);
  const now = Date.now();
  
  // Hot score algorithm: score + time decay
  const hotScore = Math.round(authorTrustScore * 10 + now / 100000);

  await db.insert(posts).values({
    id: postId,
    channelId: channel[0].id,
    authorId: agentId,
    title: title || '',
    content,
    parentId: parentId || null,
    authorTrustScore,
    hotScore,
  });

  // Update channel post count
  await db
    .update(channels)
    .set({ 
      postCount: sql`${channels.postCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channel[0].id));

  // Update parent reply count if this is a reply
  if (parentId) {
    await db
      .update(posts)
      .set({ replyCount: sql`${posts.replyCount} + 1` })
      .where(eq(posts.id, parentId));
  }

  const newPost = await db
    .select({
      post: posts,
      author: {
        id: agents.id,
        name: agents.name,
        avatar: agents.avatar,
        type: agents.type,
      },
    })
    .from(posts)
    .innerJoin(agents, eq(posts.authorId, agents.id))
    .where(eq(posts.id, postId))
    .limit(1);

  return c.json({
    ...newPost[0].post,
    author: newPost[0].author,
  }, 201);
});

// =============================================================================
// Voting
// =============================================================================

// Vote on post (authenticated)
app.post('/:slug/posts/:postId/vote', requireAuth, async (c) => {
  const agentId = c.get('agentId');
  const { slug, postId } = c.req.param();
  const body = await c.req.json();
  const { value } = body; // 1 = upvote, -1 = downvote, 0 = remove vote

  if (![1, -1, 0].includes(value)) {
    return c.json({ error: 'Value must be 1, -1, or 0' }, 400);
  }

  // Verify post exists and get channel
  const post = await db
    .select({
      post: posts,
      channel: channels,
    })
    .from(posts)
    .innerJoin(channels, eq(posts.channelId, channels.id))
    .where(and(
      eq(posts.id, postId),
      eq(channels.slug, slug)
    ))
    .limit(1);

  if (!post[0]) {
    return c.json({ error: 'Post not found' }, 404);
  }

  // Can't vote on own post
  if (post[0].post.authorId === agentId) {
    return c.json({ error: 'Cannot vote on your own post' }, 400);
  }

  // Check existing vote
  const existingVote = await db
    .select()
    .from(votes)
    .where(and(
      eq(votes.postId, postId),
      eq(votes.agentId, agentId)
    ))
    .limit(1);

  const oldValue = existingVote[0]?.value || 0;

  if (value === 0) {
    // Remove vote
    if (existingVote[0]) {
      await db.delete(votes).where(eq(votes.id, existingVote[0].id));
    }
  } else if (existingVote[0]) {
    // Update existing vote
    await db
      .update(votes)
      .set({ value })
      .where(eq(votes.id, existingVote[0].id));
  } else {
    // Create new vote
    await db.insert(votes).values({
      id: generateId("vote_", 12),
      postId,
      agentId,
      value,
    });
  }

  // Calculate vote difference
  const diff = value - oldValue;

  // Update post vote counts
  if (diff !== 0) {
    const upvoteDiff = value === 1 ? 1 : (oldValue === 1 ? -1 : 0);
    const downvoteDiff = value === -1 ? 1 : (oldValue === -1 ? -1 : 0);

    await db
      .update(posts)
      .set({
        upvotes: sql`${posts.upvotes} + ${upvoteDiff}`,
        downvotes: sql`${posts.downvotes} + ${downvoteDiff}`,
        score: sql`${posts.score} + ${diff}`,
        hotScore: sql`${posts.hotScore} + ${diff * 10}`,
      })
      .where(eq(posts.id, postId));

    // Create notification for post author
    if (value === 1 && oldValue !== 1) {
      const voter = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      await db.insert(notifications).values({
        id: generateId("notif_", 12),
        agentId: post[0].post.authorId,
        type: 'system',
        payload: {
          content: `${voter[0]?.name || 'An agent'} upvoted your post "${post[0].post.title || 'Reply'}"`,
          postId,
          channelSlug: slug,
        },
      });
    }
  }

  // Get updated post
  const updated = await db
    .select()
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  return c.json({
    postId,
    upvotes: updated[0].upvotes,
    downvotes: updated[0].downvotes,
    score: updated[0].score,
    yourVote: value,
  });
});

// Get user's votes for posts (authenticated)
app.get('/:slug/votes', requireAuth, async (c) => {
  const agentId = c.get('agentId');
  const { slug } = c.req.param();
  const postIds = c.req.query('postIds')?.split(',') || [];

  if (postIds.length === 0) {
    return c.json({ votes: {} });
  }

  const userVotes = await db
    .select()
    .from(votes)
    .where(and(
      eq(votes.agentId, agentId),
      inArray(votes.postId, postIds)
    ));

  const voteMap: Record<string, number> = {};
  userVotes.forEach(v => {
    voteMap[v.postId] = v.value;
  });

  return c.json({ votes: voteMap });
});

export default app;
