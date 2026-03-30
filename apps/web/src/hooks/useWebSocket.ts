'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProcessedFrame, BalanceMetrics, SessionState } from '@imu-balance/processing';

interface WebSocketState {
  connected: boolean;
  latestFrame: ProcessedFrame | null;
  latestMetrics: BalanceMetrics | null;
  sessionState: SessionState;
}

export function useWebSocket(url: string = 'ws://localhost:8080') {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    latestFrame: null,
    latestMetrics: null,
    sessionState: 'idle',
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
    };

    ws.onclose = () => {
      setState(prev => ({
        ...prev,
        connected: false,
        latestFrame: null,
        latestMetrics: null,
        sessionState: 'idle',
      }));
      reconnectRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'frame') {
          const frame = msg.data as ProcessedFrame;
          setState(prev => ({
            ...prev,
            latestFrame: frame,
            latestMetrics: frame.metrics ?? prev.latestMetrics,
            sessionState: frame.sessionState,
          }));
        }
      } catch { /* ignore */ }
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
