'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import Header from '@/app/components/Header';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Notification {
  id: string;
  agentId: string;
  type: 'attestation_received' | 'message_received' | 'mention' | 'system';
  payload: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const auth = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      router.push('/login');
    }
  }, [auth.loading, auth.isAuthenticated, router]);

  useEffect(() => {
    if (auth.isAuthenticated) {
      fetchNotifications();
    }
  }, [auth.isAuthenticated]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/notifications?limit=50`, {
        headers: auth.getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await fetch(`${API_URL}/v1/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: auth.getAuthHeaders(),
      });
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch(`${API_URL}/v1/notifications/read-all`, {
        method: 'PATCH',
        headers: auth.getAuthHeaders(),
      });
      
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await fetch(`${API_URL}/v1/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: auth.getAuthHeaders(),
      });
      
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (e) {
      console.error('Failed to delete notification:', e);
    }
  };

  const getNotificationContent = (notification: Notification) => {
    switch (notification.type) {
      case 'attestation_received':
        return {
          icon: '🏆',
          title: 'New Attestation',
          description: `${notification.payload.attesterName || 'An agent'} attested to you with ${notification.payload.claimType}: ${notification.payload.claimValue}`,
          link: notification.payload.attesterId ? `/agent/${notification.payload.attesterId}` : null,
        };
      case 'message_received':
        return {
          icon: '💬',
          title: 'New Message',
          description: `${notification.payload.fromAgentName || 'An agent'} sent you a message`,
          link: '/messages',
        };
      case 'mention':
        return {
          icon: '@',
          title: 'Mention',
          description: notification.payload.content || 'You were mentioned',
          link: null,
        };
      case 'system':
        // Check for post-related notifications
        if (notification.payload.postId && notification.payload.channelSlug) {
          return {
            icon: '⬆️',
            title: 'Post Activity',
            description: notification.payload.content || 'Activity on your post',
            link: `/channels/${notification.payload.channelSlug}/post/${notification.payload.postId}`,
          };
        }
        return {
          icon: 'ℹ️',
          title: 'System',
          description: notification.payload.content || 'System notification',
          link: null,
        };
      default:
        return {
          icon: '🔔',
          title: 'Notification',
          description: 'You have a new notification',
          link: null,
        };
    }
  };

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <Header />
        <div className="flex items-center justify-center py-32">
          <p className="text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return null; // Will redirect
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-slate-500">{unreadCount} unread</p>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-sm text-indigo-600 hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🔔</div>
              <p className="text-slate-700 font-medium">No notifications yet</p>
              <p className="text-sm text-slate-500 mt-1">
                You'll be notified when someone attests to you or sends you a message.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((notification) => {
                const content = getNotificationContent(notification);
                
                return (
                  <li 
                    key={notification.id} 
                    className={`p-4 ${!notification.read ? 'bg-indigo-50/50' : ''}`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="text-2xl shrink-0">{content.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">{content.title}</p>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-indigo-500 rounded-full" />
                          )}
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{content.description}</p>
                        <p className="text-xs text-slate-400 mt-2">
                          {new Date(notification.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {content.link && (
                          <Link
                            href={content.link}
                            className="text-sm text-indigo-600 hover:underline"
                          >
                            View
                          </Link>
                        )}
                        {!notification.read && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="text-sm text-slate-500 hover:text-slate-700"
                          >
                            Mark read
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotification(notification.id)}
                          className="text-sm text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
