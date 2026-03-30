#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include "config.h"

/**
 * WiFiAP — starts the ESP32 as a WiFi Access Point and streams UDP packets
 * to a connected laptop.
 *
 * The ESP32 gets static IP 192.168.4.1; DHCP assigns the laptop 192.168.4.2.
 * modem sleep is explicitly disabled (esp_wifi_set_ps(WIFI_PS_NONE)) to
 * eliminate the 50–300 ms wake-latency spikes that would otherwise corrupt
 * the 50 Hz data stream.
 *
 * Client IP detection:
 *   Rather than hardcoding 192.168.4.2, sendPacket() initially uses the DHCP
 *   default.  updateClientIP() sniffs the source address of any incoming UDP
 *   packet and overrides the destination — making the system robust to
 *   non-default DHCP assignments.
 */
class WiFiAP {
public:
    WiFiAP();

    /**
     * Start the AP, configure static IP, disable power save, open UDP socket.
     * @return true on success
     */
    bool begin();

    /**
     * Send a raw byte buffer as a single UDP datagram to the client.
     * No-op if no client IP is known yet.
     */
    void sendPacket(const uint8_t* buf, size_t len);

    /**
     * Check for any incoming UDP packet and update the client IP from its
     * source address.  Call from the UDP task at low frequency (e.g. every
     * 100 ms worth of iterations) — the laptop dashboard may send a small
     * "hello" or ack packet so we learn its real IP dynamically.
     */
    void updateClientIP();

    /** True once a client IP has been learned (or default was set). */
    bool hasClient() const { return _clientKnown; }

    /** Current destination IP as string (debug helper). */
    String clientIPString() const;

private:
    WiFiUDP   _udp;
    IPAddress _destIP;
    bool      _clientKnown;
};
