/**
 * Supabase database operations for balance sessions.
 *
 * Requires a `sessions` table in your Supabase project.
 * Run this SQL in the Supabase SQL editor to create it:
 *
 *   CREATE TABLE sessions (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     start_time  timestamptz NOT NULL,
 *     end_time    timestamptz NOT NULL,
 *     duration    float NOT NULL,
 *     final_metrics jsonb NOT NULL,
 *     created_at  timestamptz NOT NULL DEFAULT now()
 *   );
 *
 *   -- Row Level Security: users can only read/write their own sessions
 *   ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Users can manage own sessions"
 *     ON sessions FOR ALL
 *     USING (auth.uid() = user_id);
 */

import { supabase } from './supabase';
import type { Session, BalanceMetrics } from '@imu-balance/processing';

/** Session row as stored in Supabase (snake_case, ISO timestamps) */
export interface SessionRow {
  id: string;
  user_id: string;
  start_time: string;
  end_time: string;
  duration: number;
  final_metrics: BalanceMetrics;
  created_at: string;
}

/**
 * Upload a completed session to Supabase.
 */
export async function uploadSession(userId: string, session: Session): Promise<string> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      start_time: new Date(session.startTime).toISOString(),
      end_time: new Date(session.endTime).toISOString(),
      duration: session.duration,
      final_metrics: session.finalMetrics,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Get all sessions for a user, ordered by most recent first.
 */
export async function getUserSessions(
  userId: string,
  maxResults = 50,
): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('start_time', { ascending: false })
    .limit(maxResults);

  if (error) throw error;
  return data as SessionRow[];
}

/**
 * Get a single session by ID.
 */
export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) return null;
  return data as SessionRow;
}
