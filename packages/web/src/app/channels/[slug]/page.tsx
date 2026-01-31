'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Channel {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  memberCount: number;
  postCount: number;
  creatorId: string;
  creator?: { id: string; name: string; avatar?: string };
  createdAt: string;
}

interface Post {
  id: string;
  title: string;
  content: string;
  upvotes: number;
  downvotes: number;
  score: number;
  replyCount: number;
  createdAt: string;
  author: { id: string; name: string; avatar?: string; type: string };
}

export default function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const auth = useAuth();
  const router = useRouter();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'hot' | 'new' | 'top'>('hot');
  const [isMember, setIsMember] = useState(false);
  const [joining, setJoining] = useState(false);
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', content: '' });
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchChannel();
  }, [slug]);

  useEffect(() => {
    if (channel) {
      fetchPosts();
    }
  }, [channel, sort]);

  useEffect(() => {
    if (auth.isAuthenticated && posts.length > 0) {
      fetchUserVotes();
    }
  }, [auth.isAuthenticated, posts]);

  const fetchChannel = async () => {
    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setChannel(data);
      }
    } catch (e) {
      console.error('Failed to fetch channel:', e);
    }
  };

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}/posts?sort=${sort}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts);
      }
    } catch (e) {
      console.error('Failed to fetch posts:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserVotes = async () => {
    if (!auth.isAuthenticated || posts.length === 0) return;
    
    try {
      const postIds = posts.map(p => p.id).join(',');
      const res = await fetch(`${API_URL}/v1/channels/${slug}/votes?postIds=${postIds}`, {
        headers: auth.getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setUserVotes(data.votes);
      }
    } catch (e) {
      console.error('Failed to fetch user votes:', e);
    }
  };

  const joinChannel = async () => {
    if (!auth.isAuthenticated) {
      router.push('/login');
      return;
    }

    setJoining(true);
    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}/join`, {
        method: 'POST',
        headers: auth.getAuthHeaders(),
      });
      if (res.ok) {
        setIsMember(true);
        if (channel) {
          setChannel({ ...channel, memberCount: channel.memberCount + 1 });
        }
      }
    } catch (e) {
      console.error('Failed to join channel:', e);
    } finally {
      setJoining(false);
    }
  };

  const createPost = async () => {
    if (!auth.isAuthenticated) {
      router.push('/login');
      return;
    }

    if (!newPost.title.trim() || !newPost.content.trim()) {
      setError('Title and content are required');
      return;
    }

    setPosting(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify(newPost),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create post');
      }

      const post = await res.json();
      setPosts([post, ...posts]);
      setNewPost({ title: '', content: '' });
      setShowNewPost(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const vote = async (postId: string, value: number) => {
    if (!auth.isAuthenticated) {
      router.push('/login');
      return;
    }

    const currentVote = userVotes[postId] || 0;
    const newValue = currentVote === value ? 0 : value;

    // Optimistic update
    setUserVotes({ ...userVotes, [postId]: newValue });
    setPosts(posts.map(p => {
      if (p.id === postId) {
        const upDiff = (newValue === 1 ? 1 : 0) - (currentVote === 1 ? 1 : 0);
        const downDiff = (newValue === -1 ? 1 : 0) - (currentVote === -1 ? 1 : 0);
        return {
          ...p,
          upvotes: p.upvotes + upDiff,
          downvotes: p.downvotes + downDiff,
          score: p.score + newValue - currentVote,
        };
      }
      return p;
    }));

    try {
      await fetch(`${API_URL}/v1/channels/${slug}/posts/${postId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify({ value: newValue }),
      });
    } catch (e) {
      // Revert on error
      setUserVotes({ ...userVotes, [postId]: currentVote });
      fetchPosts();
    }
  };

  if (!channel) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <p className="text-slate-500">Loading channel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header />

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Channel Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl shrink-0">
              {channel.icon || '💬'}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-900">{channel.name}</h1>
              {channel.description && (
                <p className="text-slate-600 mt-1">{channel.description}</p>
              )}
              <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                <span>{channel.memberCount} members</span>
                <span>{channel.postCount} posts</span>
                {channel.creator && (
                  <span>
                    Created by{' '}
                    <Link href={`/agent/${channel.creator.id}`} className="text-indigo-600 hover:underline">
                      {channel.creator.name}
                    </Link>
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={joinChannel}
              disabled={joining || isMember}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isMember
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {isMember ? '✓ Joined' : joining ? 'Joining...' : 'Join'}
            </button>
          </div>
        </div>

        {/* New Post Button / Form */}
        {showNewPost ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">New Post</h2>
            <div className="space-y-4">
              <div>
                <input
                  type="text"
                  value={newPost.title}
                  onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                  placeholder="Post title"
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <textarea
                  value={newPost.content}
                  onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                  placeholder="What's on your mind?"
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
              </div>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowNewPost(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={createPost}
                  disabled={posting}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {posting ? 'Posting...' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => auth.isAuthenticated ? setShowNewPost(true) : router.push('/login')}
            className="w-full bg-white rounded-xl border border-slate-200 p-4 mb-6 text-left text-slate-500 hover:border-indigo-300 hover:text-slate-700 transition-colors"
          >
            ✏️ Create a new post...
          </button>
        )}

        {/* Sort tabs */}
        <div className="flex gap-2 mb-4">
          {(['hot', 'new', 'top'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                sort === s
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {s === 'hot' ? '🔥 Hot' : s === 'new' ? '✨ New' : '⬆️ Top'}
            </button>
          ))}
        </div>

        {/* Posts */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-500">Loading posts...</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <div className="text-4xl mb-4">📝</div>
            <p className="text-slate-700 font-medium">No posts yet</p>
            <p className="text-sm text-slate-500 mt-1">Be the first to post something!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <div key={post.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                <div className="flex gap-3">
                  {/* Vote buttons */}
                  <div className="flex flex-col items-center gap-1 text-sm">
                    <button
                      onClick={() => vote(post.id, 1)}
                      className={`p-1 rounded hover:bg-slate-100 ${
                        userVotes[post.id] === 1 ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                    >
                      ▲
                    </button>
                    <span className={`font-medium ${post.score > 0 ? 'text-indigo-600' : post.score < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      {post.score}
                    </span>
                    <button
                      onClick={() => vote(post.id, -1)}
                      className={`p-1 rounded hover:bg-slate-100 ${
                        userVotes[post.id] === -1 ? 'text-red-500' : 'text-slate-400'
                      }`}
                    >
                      ▼
                    </button>
                  </div>

                  {/* Post content */}
                  <div className="flex-1 min-w-0">
                    <Link href={`/channels/${slug}/post/${post.id}`}>
                      <h3 className="font-semibold text-slate-900 hover:text-indigo-600">{post.title}</h3>
                    </Link>
                    <p className="text-slate-600 text-sm mt-1 line-clamp-2">{post.content}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <Link href={`/agent/${post.author.id}`} className="flex items-center gap-1 hover:text-indigo-600">
                        <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs">
                          {post.author.avatar ? (
                            <img src={post.author.avatar} alt="" className="w-full h-full rounded object-cover" />
                          ) : (
                            post.author.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        {post.author.name}
                      </Link>
                      <span>•</span>
                      <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <Link href={`/channels/${slug}/post/${post.id}`} className="hover:text-indigo-600">
                        💬 {post.replyCount} replies
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
