/**
 * Supabase client initialization and auth helpers.
 *
 * Configure your Supabase project credentials in environment variables:
 * NEXT_PUBLIC_SUPABASE_URL       — Project URL from Supabase dashboard
 * NEXT_PUBLIC_SUPABASE_ANON_KEY  — Anon/public key from Supabase dashboard
 */

import { createClient } from '@supabase/supabase-js';
import type { User, Session as SupabaseSession } from '@supabase/supabase-js';

export type { User };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Single shared client — safe for both client and server components
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ---- Auth helpers ----

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthChange(
  callback: (user: User | null) => void,
): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}

export async function getUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
