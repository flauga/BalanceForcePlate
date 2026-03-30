/**
 * WebSocket server for broadcasting processed IMU data to browser clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { ProcessedFrame, Session } from '@imu-balance/processing';

export class WsBroadcaster {
  private wss: WebSocketServer;

  constructor(port: number = 8080) {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      console.log(`[WS] Client connected (total: ${this.wss.clients.size})`);

      ws.on('close', () => {
        console.log(`[WS] Client disconnected (total: ${this.wss.clients.size})`);
      });
    });

    console.log(`[WS] Server listening on ws://localhost:${port}`);
  }

  /** Broadcast a processed frame to all connected clients */
  broadcastFrame(frame: ProcessedFrame): void {
    const message = JSON.stringify({
      type: 'frame',
      data: frame,
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /** Broadcast a session completion event */
  broadcastSessionEnd(session: Session): void {
    // Send session without raw data to keep message size reasonable
    const summary = {
      id: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      finalMetrics: session.finalMetrics,
    };

    const message = JSON.stringify({
      type: 'session_end',
      data: summary,
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /** Broadcast connection status */
  broadcastStatus(status: Record<string, unknown>): void {
    const message = JSON.stringify({
      type: 'status',
      data: status,
    });

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /** Get number of connected clients */
  getClientCount(): number {
    return this.wss.clients.size;
  }

  /** Close the WebSocket server */
  close(): void {
    this.wss.close();
  }
}
