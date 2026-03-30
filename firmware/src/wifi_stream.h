#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>

/**
 * WiFiStream — streams IMU JSON Lines over a TCP socket.
 *
 * The ESP32 acts as a TCP server on WIFI_TCP_PORT.
 * One client is accepted at a time. The local server connects by
 * resolving the mDNS hostname "imu-balance.local" or by IP address.
 *
 * Serial output is always active; WiFi is an additional channel.
 */
class WiFiStream {
public:
    WiFiStream(uint16_t port, const char* hostname = "imu-balance");

    // Connect to WiFi and start the TCP server + mDNS.
    // Returns true on successful WiFi connection.
    bool begin(const char* ssid, const char* password, uint32_t timeoutMs = 10000);

    // Call once per loop iteration to accept new clients.
    void update();

    // Send a line to the connected TCP client (if any).
    // Mirrors Serial.println() so callers can treat both the same.
    void println(const String& line);
    void println(const char* line);

    // True if a TCP client is currently connected.
    bool clientConnected() const;

    // True if WiFi is connected.
    bool wifiConnected() const;

    // IP address as string (or "" if not connected).
    String ipAddress() const;

private:
    uint16_t _port;
    const char* _hostname;
    WiFiServer _server;
    WiFiClient _client;
};
