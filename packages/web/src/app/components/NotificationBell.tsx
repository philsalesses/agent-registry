'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';

interface Notification {
  id: string;
  agentId: string;
  type: 'attestation_received' | 'message_received' | 'mention' | 'system';
  payload: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [credentials, setCredentials] = useState<{ agentId: string; privateKey: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load credentials from localStorage
    const saved = localStorage.getItem('ans_credentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCredentials(parsed);
      } catch {
        // Invalid saved credentials
      }
    }
  }, []);

  useEffect(() => {
    if (!credentials) return;

    // Fetch notification count
    const fetchCount = async () => {
      try {
        const res = await fetch(`${API_URL}/v1/notifications/count`, {
          headers: {
            'X-Agent-Id': credentials.agentId,
            'X-Agent-Private-Key': credentials.privateKey,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.unreadCount);
        }
      } catch (e) {
        console.error('Failed to fetch notification count:', e);
      }
    };

    fetchCount();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [credentials]);

  const fetchNotifications = async () => {
    if (!credentials) return;
    
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/notifications?limit=10`, {
        headers: {
          'X-Agent-Id': credentials.agentId,
          'X-Agent-Private-Key': credentials.privateKey,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    fetchNotifications();
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
      setUnreadCount(prev => Math.max(0, prev - 1));
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
      setUnreadCount(0);
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  const getNotificationText = (notification: Notification): string => {
    switch (notification.type) {
      case 'attestation_received':
        return `${notification.payload.attesterName || 'An agent'} attested to you`;
      case 'message_received':
        return `New message from ${notification.payload.fromAgentName || 'an agent'}`;
      case 'mention':
        return `You were mentioned by ${notification.payload.byAgentName || 'an agent'}`;
      case 'system':
        return notification.payload.content || 'System notification';
      default:
        return 'New notification';
    }
  };

  const getNotificationLink = (notification: Notification): string | null => {
    switch (notification.type) {
      case 'attestation_received':
        return notification.payload.attesterId ? `/agent/${notification.payload.attesterId}` : null;
      case 'message_received':
        return '/messages';
      default:
        return null;
    }
  };

  if (!credentials) {
    return null; // Don't show bell if not logged in
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-sm text-indigo-600 hover:underline"
                >
                  Mark all as read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Loading...</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No notifications yet</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {notifications.map((notification) => {
                    const link = getNotificationLink(notification);
                    const content = (
                      <div 
                        className={`p-4 hover:bg-gray-50 cursor-pointer ${!notification.read ? 'bg-indigo-50/50' : ''}`}
                        onClick={() => !notification.read && markAsRead(notification.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 mt-2 rounded-full shrink-0 ${notification.read ? 'bg-gray-300' : 'bg-indigo-500'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900">{getNotificationText(notification)}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(notification.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    );

                    return link ? (
                      <li key={notification.id}>
                        <Link href={link} onClick={() => setIsOpen(false)}>
                          {content}
                        </Link>
                      </li>
                    ) : (
                      <li key={notification.id}>{content}</li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="p-3 border-t border-gray-200">
              <Link
                href="/notifications"
                className="block text-center text-sm text-indigo-600 hover:underline"
                onClick={() => setIsOpen(false)}
              >
                View all notifications
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
