/**
 * WebSocket server for broadcasting processed force plate data to browser clients.
 * Also accepts incoming command messages from clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { ProcessedFrame, Session } from '@force-plate/processing';

type CommandCallback = (cmd: Record<string, unknown>) => void;

export class WsBroadcaster {
  private wss: WebSocketServer;
  private onCommand?: CommandCallback;

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      console.log(`[WS] Client connected (total: ${this.wss.clients.size})`);

      // Accept commands from browser clients
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'command' && msg.data) {
            this.onCommand?.(msg.data as Record<string, unknown>);
          }
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected (total: ${this.wss.clients.size})`);
      });
    });

    console.log(`[WS] Server listening on ws://localhost:${port}`);
  }

  /** Register a handler for commands sent by browser clients. */
  setCommandHandler(cb: CommandCallback): void {
    this.onCommand = cb;
  }

  /** Broadcast a processed frame to all connected clients */
  broadcastFrame(frame: ProcessedFrame): void {
    const message = JSON.stringify({ type: 'frame', data: frame });
    this._send(message);
  }

  /** Broadcast a session completion event */
  broadcastSessionEnd(session: Session): void {
    const summary = {
      id: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      finalMetrics: session.finalMetrics,
    };
    this._send(JSON.stringify({ type: 'session_end', data: summary }));
  }

  /** Broadcast connection/ESP status */
  broadcastStatus(status: Record<string, unknown>): void {
    this._send(JSON.stringify({ type: 'status', data: status }));
  }

  /**
   * Broadcast live load cell readings to all connected clients.
   * Sent during both real streaming and sample simulation.
   */
  broadcastLoadcellValues(connectedCount: number, channelCount: number, values: number[]): void {
    this._send(JSON.stringify({
      type: 'loadcells_values',
      data: { connected_count: connectedCount, channel_count: channelCount, values },
    }));
  }

  private _send(message: string): void {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  getClientCount(): number { return this.wss.clients.size; }

  close(): void { this.wss.close(); }
}
