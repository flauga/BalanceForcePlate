#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <functional>

/**
 * WiFiStream — streams force plate data over WiFi.
 *
 * Uses a hybrid transport:
 *   - UDP for high-frequency data lines (40 Hz posting) — fire-and-forget,
 *     no ACK delays, no congestion window stalls.
 *   - TCP for commands (inbound) and status/cal messages (outbound) — these
 *     are low-frequency and need reliability.
 *
 * The server (Node.js) connects via TCP to receive status/cal and send commands.
 * It also listens on UDP_PORT for the data stream.
 *
 * Serial output is always active; WiFi is an additional channel.
 */
class WiFiStream {
public:
    static constexpr uint16_t UDP_PORT = 8889;  // data stream port

    WiFiStream(uint16_t tcpPort, const char* hostname = "force-plate");

    // Connect to WiFi and start the TCP server + mDNS.
    bool begin(const char* ssid, const char* password, uint32_t timeoutMs = 10000);

    // Call once per loop iteration to accept new clients.
    void update();

    // Send a data line via UDP to the connected client (for high-frequency posting).
    // Falls back to TCP if no UDP target is known.
    void sendData(const char* line);

    // Send a line via TCP to the connected client (for status/cal messages).
    void println(const String& line);
    void println(const char* line);

    // Register a callback invoked whenever a new TCP client connects.
    void setClientConnectedCallback(std::function<void()> cb);

    // Read a newline-terminated command from the TCP client (non-blocking).
    String readLine();

    // True if a TCP client is currently connected.
    bool clientConnected();

    // True if WiFi is connected.
    bool wifiConnected() const;

    // IP address as string (or "" if not connected).
    String ipAddress() const;

private:
    uint16_t _tcpPort;
    const char* _hostname;
    WiFiServer _server;
    WiFiClient _client;
    WiFiUDP    _udp;
    IPAddress  _clientIP;
    bool       _hasClientIP = false;
    std::function<void()> _onClientConnected;
    char    _wifiBuf[64];
    uint8_t _wifiBufLen = 0;
    bool     _pendingConnected = false;
    uint8_t  _writeFails = 0;
    uint32_t _writeDrops = 0;
};
