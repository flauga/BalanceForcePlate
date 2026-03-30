#include "wifi_stream.h"

WiFiStream::WiFiStream(uint16_t port, const char* hostname)
    : _port(port)
    , _hostname(hostname)
    , _server(port)
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

    Serial.print("{\"status\":\"wifi_connected\",\"ip\":\"");
    Serial.print(WiFi.localIP().toString());
    Serial.print("\",\"mdns\":\"");
    Serial.print(_hostname);
    Serial.println(".local\"}");

    // Start mDNS so clients can reach us as <hostname>.local
    if (MDNS.begin(_hostname)) {
        MDNS.addService("_imu-balance", "_tcp", _port);
    }

    _server.begin();
    _server.setNoDelay(true);

    return true;
}

void WiFiStream::update() {
    // Accept new client if none connected
    if (!_client || !_client.connected()) {
        if (_client) {
            _client.stop();
        }
        WiFiClient newClient = _server.accept();
        if (newClient) {
            _client = newClient;
            Serial.println("{\"status\":\"wifi_client_connected\"}");
            // Send the ready banner to the new client
            _client.println("{\"status\":\"ready\",\"sensor\":\"bmi323\",\"rate\":100}");
        }
    }
}

void WiFiStream::println(const String& line) {
    if (_client && _client.connected()) {
        _client.println(line);
    }
}

void WiFiStream::println(const char* line) {
    if (_client && _client.connected()) {
        _client.println(line);
    }
}

bool WiFiStream::clientConnected() const {
    return _client && _client.connected();
}

bool WiFiStream::wifiConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

String WiFiStream::ipAddress() const {
    if (WiFi.status() != WL_CONNECTED) return "";
    return WiFi.localIP().toString();
}
