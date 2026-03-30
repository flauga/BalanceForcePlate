#include "wifi_ap.h"
#include <esp_wifi.h>   // for esp_wifi_set_ps()

// Default destination: first DHCP client address on the ESP32 AP subnet.
static const IPAddress kDefaultClientIP(192, 168, 4, 2);

// ---- Constructor ----

WiFiAP::WiFiAP()
    : _destIP(kDefaultClientIP)
    , _clientKnown(false)
{}

// ---- begin() ----

bool WiFiAP::begin() {
    // 1. Start the softAP.
    //    softAP(ssid, password, channel, ssid_hidden, max_connection)
    //    password "" → open (no encryption); pass a non-empty string for WPA2.
    const char* pass = WIFI_AP_PASSWORD;
    bool ok = WiFi.softAP(WIFI_AP_SSID,
                          (strlen(pass) > 0) ? pass : nullptr,
                          WIFI_AP_CHANNEL,
                          0,                   // ssid_hidden = 0 → visible
                          WIFI_AP_MAX_CONN);

    if (!ok) {
        Serial.println("[WiFiAP] softAP() failed");
        return false;
    }

    // 2. Override the default AP gateway/subnet to canonical 192.168.4.x.
    WiFi.softAPConfig(IPAddress(192, 168, 4, 1),   // AP IP
                      IPAddress(192, 168, 4, 1),   // gateway (= AP IP)
                      IPAddress(255, 255, 255, 0)); // subnet mask

    // 3. Disable modem sleep — critical for low-latency UDP streaming.
    //    Must be called AFTER softAP(); calling it before has no effect.
    esp_wifi_set_ps(WIFI_PS_NONE);

    // 4. Open the local UDP socket.
    _udp.begin(UDP_LOCAL_PORT);

    // Pre-populate the default destination; will be updated dynamically.
    _destIP = kDefaultClientIP;
    _clientKnown = true;   // optimistic: DHCP usually assigns .2 to first client

    Serial.printf("[WiFiAP] AP started: SSID=%s  IP=192.168.4.1  Ch=%d\n",
                  WIFI_AP_SSID, WIFI_AP_CHANNEL);
    return true;
}

// ---- sendPacket() ----

void WiFiAP::sendPacket(const uint8_t* buf, size_t len) {
    if (!_clientKnown) return;

    _udp.beginPacket(_destIP, UDP_DEST_PORT);
    _udp.write(buf, len);
    _udp.endPacket();
}

// ---- updateClientIP() ----

void WiFiAP::updateClientIP() {
    int pktSize = _udp.parsePacket();
    if (pktSize > 0) {
        IPAddress remote = _udp.remoteIP();
        if (remote != _destIP) {
            _destIP = remote;
            Serial.printf("[WiFiAP] client IP updated to %s\n",
                          remote.toString().c_str());
        }
        _clientKnown = true;
        // Drain the packet so the socket buffer stays clear.
        while (_udp.available()) _udp.read();
    }
}

// ---- clientIPString() ----

String WiFiAP::clientIPString() const {
    return _destIP.toString();
}
