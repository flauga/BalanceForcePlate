#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <functional>

/// One SSID + password pair.
struct WifiCredential {
    const char* ssid;
    const char* password;
};

/**
 * WiFiStream — streams force plate data over a WebSocket.
 *
 * Browser clients connect directly to ws://<hostname>.local:<wsPort> (default 80)
 * and receive every outbound text line (status, cal, posting) as WebSocket
 * TEXT frames. Inbound TEXT frames are treated as commands (same syntax as
 * serial), queued, and drained by readLine() in the main loop.
 *
 * Multiple clients may connect simultaneously; broadcasts reach all of them.
 *
 * Serial output remains active in parallel for debugging.
 */
class WiFiStream {
public:
    WiFiStream(uint16_t wsPort = 80, const char* hostname = "force-plate");

    // Try each credential in order; connect to the first one that responds.
    // Returns true if WiFi + WebSocket server are up.
    bool begin(const WifiCredential* creds, size_t count, uint32_t timeoutMs = 10000);

    // Call every loop iteration to service the WebSocket.
    void update();

    // Broadcast a text line to every connected client. Used for the 40 Hz
    // posting stream (sendData) as well as low-frequency status / info /
    // calibration messages (println). Both paths are identical over
    // WebSocket — they only differed on the old TCP+UDP hybrid.
    void sendData(const char* line);
    void println(const String& line);
    void println(const char* line);

    // Register a callback invoked when a WebSocket client connects, so the
    // app can re-send initial state (e.g. status JSON) to the new client.
    void setClientConnectedCallback(std::function<void()> cb);

    // Pop the next queued command received from any client (non-blocking).
    // Returns "" if no command is pending.
    String readLine();

private:
    uint16_t _wsPort;
    const char* _hostname;
    WebSocketsServer _ws;
    std::function<void()> _onClientConnected;

    // Single-slot command buffer — commands arrive at human cadence, so a
    // deeper queue is unnecessary. If a second command arrives before
    // readLine() drains the first, the newer one is dropped.
    String _pendingCmd;

    // Set by the event handler; consumed by update().
    volatile bool _pendingConnected = false;

    bool _postConnect();

    // Static trampoline so WebSocketsServer can call our member handler.
    static WiFiStream* _instance;
    static void _onEventStatic(uint8_t num, WStype_t type, uint8_t* payload, size_t length);
    void _onEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length);
};
