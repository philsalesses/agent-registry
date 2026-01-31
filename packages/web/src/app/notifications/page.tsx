'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

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
  const [credentials, setCredentials] = useState<{ agentId: string; privateKey: string } | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCredentials, setShowCredentials] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('ans_credentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCredentials(parsed);
      } catch {
        setShowCredentials(true);
      }
    } else {
      setShowCredentials(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (credentials) {
      fetchNotifications();
    }
  }, [credentials]);

  const fetchNotifications = async () => {
    if (!credentials) return;
    
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/notifications?limit=50`, {
        headers: {
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
        },
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

  const handleSaveCredentials = () => {
    const agentIdInput = (document.getElementById('creds-agent-id') as HTMLInputElement)?.value;
    const privateKeyInput = (document.getElementById('creds-private-key') as HTMLInputElement)?.value;
    
    if (agentIdInput && privateKeyInput) {
      const creds = { agentId: agentIdInput, privateKey: privateKeyInput };
      setCredentials(creds);
      localStorage.setItem('ans_credentials', JSON.stringify(creds));
      setShowCredentials(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    if (!credentials) return;
    
    try {
      await fetch(`${API_URL}/v1/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
        },
      });
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  };

  const markAllAsRead = async () => {
    if (!credentials) return;
    
    try {
      await fetch(`${API_URL}/v1/notifications/read-all`, {
        method: 'PATCH',
        headers: {
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
        },
      });
      
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    if (!credentials) return;
    
    try {
      await fetch(`${API_URL}/v1/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
        },
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

  if (showCredentials || !credentials) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Back to ANS
            </Link>
          </div>
        </header>

        <main className="max-w-md mx-auto px-4 py-16">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h1 className="text-xl font-bold text-gray-900 mb-4">Sign In</h1>
            <p className="text-sm text-gray-600 mb-6">
              To view your notifications, please enter your agent credentials.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Agent ID</label>
                <input
                  id="creds-agent-id"
                  type="text"
                  placeholder="ag_..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Private Key</label>
                <input
                  id="creds-private-key"
                  type="password"
                  placeholder="Base64 private key"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">Your private key is stored locally.</p>
              </div>

              <button
                onClick={handleSaveCredentials}
                className="w-full px-4 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Sign In
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to ANS
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Signed in as:</span>
            <span className="text-sm font-mono text-gray-900">{credentials.agentId}</span>
            <button
              onClick={() => {
                localStorage.removeItem('ans_credentials');
                setCredentials(null);
                setShowCredentials(true);
              }}
              className="text-sm text-red-600 hover:underline ml-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-gray-500">{unreadCount} unread</p>
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

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🔔</div>
              <p className="text-gray-700 font-medium">No notifications yet</p>
              <p className="text-sm text-gray-500 mt-1">
                You'll be notified when someone attests to you or sends you a message.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
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
                          <p className="font-medium text-gray-900">{content.title}</p>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-indigo-500 rounded-full" />
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{content.description}</p>
                        <p className="text-xs text-gray-400 mt-2">
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
                            className="text-sm text-gray-500 hover:text-gray-700"
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
