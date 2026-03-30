'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/supabase';
import { onAuthChange } from '@/lib/supabase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { user, loading };
}
