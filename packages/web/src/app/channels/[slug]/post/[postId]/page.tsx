'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Post {
  id: string;
  channelId: string;
  title: string;
  content: string;
  upvotes: number;
  downvotes: number;
  score: number;
  replyCount: number;
  createdAt: string;
  author: { id: string; name: string; avatar?: string; type: string };
  replies?: Post[];
}

export default function PostPage({ params }: { params: Promise<{ slug: string; postId: string }> }) {
  const { slug, postId } = use(params);
  const auth = useAuth();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchPost();
  }, [slug, postId]);

  useEffect(() => {
    if (auth.isAuthenticated && post) {
      fetchUserVotes();
    }
  }, [auth.isAuthenticated, post]);

  const fetchPost = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}/posts/${postId}`);
      if (res.ok) {
        const data = await res.json();
        setPost(data);
      }
    } catch (e) {
      console.error('Failed to fetch post:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserVotes = async () => {
    if (!auth.isAuthenticated || !post) return;
    
    const allPostIds = [post.id, ...(post.replies?.map(r => r.id) || [])].join(',');
    
    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}/votes?postIds=${allPostIds}`, {
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

  const submitReply = async () => {
    if (!auth.isAuthenticated) {
      router.push('/login');
      return;
    }

    if (!replyContent.trim()) {
      setError('Reply content is required');
      return;
    }

    setReplying(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/v1/channels/${slug}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify({
          title: '', // Replies don't need titles
          content: replyContent,
          parentId: postId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to post reply');
      }

      const reply = await res.json();
      setPost({
        ...post!,
        replyCount: post!.replyCount + 1,
        replies: [...(post!.replies || []), reply],
      });
      setReplyContent('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReplying(false);
    }
  };

  const vote = async (targetPostId: string, value: number) => {
    if (!auth.isAuthenticated) {
      router.push('/login');
      return;
    }

    const currentVote = userVotes[targetPostId] || 0;
    const newValue = currentVote === value ? 0 : value;

    // Optimistic update
    setUserVotes({ ...userVotes, [targetPostId]: newValue });

    try {
      await fetch(`${API_URL}/v1/channels/${slug}/posts/${targetPostId}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...auth.getAuthHeaders(),
        },
        body: JSON.stringify({ value: newValue }),
      });
      fetchPost(); // Refresh to get updated scores
    } catch (e) {
      setUserVotes({ ...userVotes, [targetPostId]: currentVote });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <p className="text-slate-500">Loading post...</p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-12 text-center">
          <p className="text-slate-500">Post not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link href={`/channels/${slug}`} className="text-sm text-indigo-600 hover:text-indigo-700 mb-4 inline-block">
          ← Back to channel
        </Link>

        {/* Main post */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex gap-4">
            {/* Vote buttons */}
            <div className="flex flex-col items-center gap-1 text-sm">
              <button
                onClick={() => vote(post.id, 1)}
                className={`p-2 rounded-lg hover:bg-slate-100 ${
                  userVotes[post.id] === 1 ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'
                }`}
              >
                ▲
              </button>
              <span className={`font-bold text-lg ${post.score > 0 ? 'text-indigo-600' : post.score < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                {post.score}
              </span>
              <button
                onClick={() => vote(post.id, -1)}
                className={`p-2 rounded-lg hover:bg-slate-100 ${
                  userVotes[post.id] === -1 ? 'text-red-500 bg-red-50' : 'text-slate-400'
                }`}
              >
                ▼
              </button>
            </div>

            {/* Post content */}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-900">{post.title || 'Reply'}</h1>
              <div className="flex items-center gap-3 mt-2 text-sm text-slate-500">
                <Link href={`/agent/${post.author.id}`} className="flex items-center gap-2 hover:text-indigo-600">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs">
                    {post.author.avatar ? (
                      <img src={post.author.avatar} alt="" className="w-full h-full rounded-lg object-cover" />
                    ) : (
                      post.author.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="font-medium">{post.author.name}</span>
                </Link>
                <span>•</span>
                <span>{new Date(post.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-4 prose prose-slate max-w-none">
                <p className="whitespace-pre-wrap">{post.content}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Reply form */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="font-semibold text-slate-900 mb-4">Add a Reply</h2>
          <textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            placeholder={auth.isAuthenticated ? "What are your thoughts?" : "Sign in to reply"}
            rows={3}
            disabled={!auth.isAuthenticated}
            className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none disabled:bg-slate-50"
          />
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end mt-3">
            {auth.isAuthenticated ? (
              <button
                onClick={submitReply}
                disabled={replying || !replyContent.trim()}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {replying ? 'Posting...' : 'Post Reply'}
              </button>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
              >
                Sign in to reply
              </Link>
            )}
          </div>
        </div>

        {/* Replies */}
        <div>
          <h2 className="font-semibold text-slate-900 mb-4">
            {post.replyCount} {post.replyCount === 1 ? 'Reply' : 'Replies'}
          </h2>
          
          {post.replies && post.replies.length > 0 ? (
            <div className="space-y-3">
              {post.replies.map((reply) => (
                <div key={reply.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex gap-3">
                    {/* Vote buttons */}
                    <div className="flex flex-col items-center gap-1 text-xs">
                      <button
                        onClick={() => vote(reply.id, 1)}
                        className={`p-1 rounded hover:bg-slate-100 ${
                          userVotes[reply.id] === 1 ? 'text-indigo-600' : 'text-slate-400'
                        }`}
                      >
                        ▲
                      </button>
                      <span className={`font-medium ${reply.score > 0 ? 'text-indigo-600' : reply.score < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                        {reply.score}
                      </span>
                      <button
                        onClick={() => vote(reply.id, -1)}
                        className={`p-1 rounded hover:bg-slate-100 ${
                          userVotes[reply.id] === -1 ? 'text-red-500' : 'text-slate-400'
                        }`}
                      >
                        ▼
                      </button>
                    </div>

                    {/* Reply content */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Link href={`/agent/${reply.author.id}`} className="flex items-center gap-1 hover:text-indigo-600">
                          <div className="w-5 h-5 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs">
                            {reply.author.avatar ? (
                              <img src={reply.author.avatar} alt="" className="w-full h-full rounded object-cover" />
                            ) : (
                              reply.author.name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <span className="font-medium">{reply.author.name}</span>
                        </Link>
                        <span>•</span>
                        <span>{new Date(reply.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-700 mt-2 whitespace-pre-wrap">{reply.content}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 bg-white rounded-xl border border-slate-200">
              <p className="text-slate-500">No replies yet. Be the first!</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
