/**
 * Local file-based session storage.
 *
 * Stores completed balance sessions as:
 *   <id>.json        — session metadata + metrics (no raw data, small)
 *   <id>-raw.csv     — raw 40Hz force plate samples (re-processable)
 *   <id>-processed.csv — orientation + metrics time series (analysis-ready)
 */

import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Session, sessionToRawCSV, sessionToProcessedCSV } from '@force-plate/processing';

export class SessionStore {
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || join(homedir(), '.force-plate', 'sessions');
    mkdirSync(this.storePath, { recursive: true });
  }

  /** Save session metadata JSON + both CSV files. Returns the JSON path. */
  save(session: Session): string {
    // JSON — metadata only (small, always written)
    const jsonPath = join(this.storePath, `${session.id}.json`);
    const toSave = { ...session, rawData: undefined, timeSeries: undefined };
    writeFileSync(jsonPath, JSON.stringify(toSave, null, 2));

    // Raw CSV — only if raw data was captured
    if (session.rawData && session.rawData.length > 0) {
      const rawPath = join(this.storePath, `${session.id}-raw.csv`);
      writeFileSync(rawPath, sessionToRawCSV(session));
      console.log(`[Store] Raw CSV:       ${rawPath}`);
    }

    // Processed CSV — only if time series was captured
    if (session.timeSeries && session.timeSeries.length > 0) {
      const procPath = join(this.storePath, `${session.id}-processed.csv`);
      writeFileSync(procPath, sessionToProcessedCSV(session));
      console.log(`[Store] Processed CSV: ${procPath}`);
    }

    console.log(`[Store] Session JSON:  ${jsonPath}`);
    return jsonPath;
  }

  /** Load a session by ID (metadata only — no raw/time-series data). */
  load(sessionId: string): Session | null {
    const filepath = join(this.storePath, `${sessionId}.json`);
    try {
      return JSON.parse(readFileSync(filepath, 'utf-8')) as Session;
    } catch {
      return null;
    }
  }

  /**
   * Return the contents of a CSV file for a session.
   * type: 'raw' | 'processed'
   */
  loadCSV(sessionId: string, type: 'raw' | 'processed'): string | null {
    const filepath = join(this.storePath, `${sessionId}-${type}.csv`);
    try {
      return readFileSync(filepath, 'utf-8');
    } catch {
      return null;
    }
  }

  /** Check which CSV files exist for a session. */
  csvFiles(sessionId: string): { raw: boolean; processed: boolean } {
    return {
      raw:       existsSync(join(this.storePath, `${sessionId}-raw.csv`)),
      processed: existsSync(join(this.storePath, `${sessionId}-processed.csv`)),
    };
  }

  /** List all saved session summaries, newest first. */
  list(): Array<{ id: string; startTime: number; duration: number; score: number }> {
    const files = readdirSync(this.storePath)
      .filter(f => f.endsWith('.json') && !f.includes('-'));

    const sessions: Array<{ id: string; startTime: number; duration: number; score: number }> = [];
    for (const file of files) {
      try {
        const session = JSON.parse(readFileSync(join(this.storePath, file), 'utf-8')) as Session;
        sessions.push({
          id: session.id,
          startTime: session.startTime,
          duration: session.duration,
          score: session.finalMetrics.balanceScore,
        });
      } catch { /* skip corrupted */ }
    }

    return sessions.sort((a, b) => b.startTime - a.startTime);
  }

  getStorePath(): string {
    return this.storePath;
  }
}
