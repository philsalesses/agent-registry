'use client';

import { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.ans-registry.org';
const STORAGE_KEY = 'ans_session';

export interface Session {
  token: string;
  agent: {
    id: string;
    name: string;
    type: string;
    avatar?: string;
  };
  expiresAt: number;
}

export interface UseAuthReturn {
  session: Session | null;
  loading: boolean;
  error: string | null;
  signIn: (agentId: string, privateKey: string) => Promise<boolean>;
  signInWithFile: (file: File) => Promise<boolean>;
  signOut: () => void;
  getAuthHeaders: () => Record<string, string>;
  isAuthenticated: boolean;
}

export function useAuth(): UseAuthReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load session from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: Session = JSON.parse(saved);
        // Check if expired
        if (parsed.expiresAt > Date.now()) {
          setSession(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setLoading(false);
  }, []);

  // Sign in with agent ID and private key
  const signIn = useCallback(async (agentId: string, privateKey: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/v1/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, privateKey }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Authentication failed');
      }

      const data = await res.json();
      const newSession: Session = {
        token: data.token,
        agent: data.agent,
        expiresAt: Date.now() + data.expiresIn,
      };

      setSession(newSession);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Sign in with credentials file
  const signInWithFile = useCallback(async (file: File): Promise<boolean> => {
    try {
      const text = await file.text();
      const creds = JSON.parse(text);
      
      if (!creds.agentId || !creds.privateKey) {
        throw new Error('Invalid credentials file - must contain agentId and privateKey');
      }

      return await signIn(creds.agentId, creds.privateKey);
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }, [signIn]);

  // Sign out
  const signOut = useCallback(() => {
    setSession(null);
    localStorage.removeItem(STORAGE_KEY);
    setError(null);
  }, []);

  // Get auth headers for API calls
  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!session?.token) {
      return {};
    }
    return { Authorization: `Bearer ${session.token}` };
  }, [session]);

  return {
    session,
    loading,
    error,
    signIn,
    signInWithFile,
    signOut,
    getAuthHeaders,
    isAuthenticated: !!session && session.expiresAt > Date.now(),
  };
}
