#include <Arduino.h>
#include <esp_wifi.h>
#include "wifi_stream.h"

WiFiStream::WiFiStream(uint16_t tcpPort, const char* hostname)
    : _tcpPort(tcpPort)
    , _hostname(hostname)
    , _server(tcpPort)
{
}

bool WiFiStream::begin(const char* ssid, const char* password, uint32_t timeoutMs) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    Serial.print("{\"status\":\"wifi_connecting\",\"ssid\":\"");
    Serial.print(ssid);
    Serial.println("\"}");

    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start > timeoutMs) {
            Serial.println("{\"status\":\"wifi_timeout\"}");
            return false;
        }
        delay(200);
    }

    // Disable modem-sleep so the radio stays active continuously.
    esp_wifi_set_ps(WIFI_PS_NONE);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);

    Serial.print("{\"status\":\"wifi_connected\",\"ip\":\"");
    Serial.print(WiFi.localIP().toString());
    Serial.print("\",\"mdns\":\"");
    Serial.print(_hostname);
    Serial.print(".local\",\"udpPort\":");
    Serial.print(UDP_PORT);
    Serial.println("}");

    // Start mDNS
    if (MDNS.begin(_hostname)) {
        MDNS.addService("_force-plate", "_tcp", _tcpPort);
    }

    // Start TCP server for commands and status
    _server.begin();
    _server.setNoDelay(true);

    // Start UDP socket for data streaming
    _udp.begin(UDP_PORT);

    Serial.print("{\"status\":\"wifi_ps_mode\",\"mode\":");
    wifi_ps_type_t psMode;
    esp_wifi_get_ps(&psMode);
    Serial.print((int)psMode);
    Serial.println("}");

    return true;
}

void WiFiStream::update() {
    // Accept new TCP client if none connected
    if (!_client || !_client.connected()) {
        if (_client) {
            _client.stop();
            _hasClientIP = false;
        }
        WiFiClient newClient = _server.accept();
        if (newClient) {
            _client = newClient;
            _client.setNoDelay(true);
            _clientIP = _client.remoteIP();
            _hasClientIP = true;
            Serial.print("{\"status\":\"wifi_client_connected\",\"clientIP\":\"");
            Serial.print(_clientIP.toString());
            Serial.println("\"}");
            _pendingConnected = true;
        }
    }

    if (_pendingConnected) {
        _pendingConnected = false;
        if (_onClientConnected) _onClientConnected();
    }
}

void WiFiStream::sendData(const char* line) {
    if (!_hasClientIP) return;

    // Send via UDP — no ACK, no congestion window, no delayed ACK.
    // At 40 Hz * ~80 bytes = 3.2 KB/s, well within WiFi capacity.
    _udp.beginPacket(_clientIP, UDP_PORT);
    _udp.println(line);
    _udp.endPacket();
}

void WiFiStream::println(const String& line) {
    println(line.c_str());
}

void WiFiStream::println(const char* line) {
    if (!_client || !_client.connected()) return;

    size_t written = _client.println(line);
    if (written == 0) {
        if (++_writeFails >= 3) { _client.stop(); _writeFails = 0; _hasClientIP = false; }
    } else {
        _writeFails = 0;
    }
}

void WiFiStream::setClientConnectedCallback(std::function<void()> cb) {
    _onClientConnected = cb;
}

String WiFiStream::readLine() {
    if (!_client || !_client.connected()) return "";
    while (_client.available()) {
        char c = (char)_client.read();
        if (c == '\n' || c == '\r') {
            if (_wifiBufLen > 0) {
                _wifiBuf[_wifiBufLen] = '\0';
                String result(_wifiBuf);
                _wifiBufLen = 0;
                return result;
            }
        } else if (_wifiBufLen < sizeof(_wifiBuf) - 1) {
            _wifiBuf[_wifiBufLen++] = c;
        }
    }
    return "";
}

bool WiFiStream::clientConnected() {
    return _client && _client.connected();
}

bool WiFiStream::wifiConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

String WiFiStream::ipAddress() const {
    if (WiFi.status() != WL_CONNECTED) return "";
    return WiFi.localIP().toString();
}
