#include <Arduino.h>
#include <esp_wifi.h>
#include "wifi_stream.h"

WiFiStream* WiFiStream::_instance = nullptr;

WiFiStream::WiFiStream(uint16_t wsPort, const char* hostname)
    : _wsPort(wsPort)
    , _hostname(hostname)
    , _ws(wsPort)
{
    _instance = this;
}

bool WiFiStream::begin(const WifiCredential* creds, size_t count, uint32_t timeoutMs) {
    WiFi.mode(WIFI_STA);

    for (size_t i = 0; i < count; ++i) {
        WiFi.begin(creds[i].ssid, creds[i].password);

        Serial.print("{\"status\":\"wifi_connecting\",\"ssid\":\"");
        Serial.print(creds[i].ssid);
        Serial.print("\",\"attempt\":");
        Serial.print(i + 1);
        Serial.print(",\"of\":");
        Serial.print(count);
        Serial.println("}");

        const uint32_t start = millis();
        while (WiFi.status() != WL_CONNECTED) {
            if (millis() - start > timeoutMs) {
                Serial.print("{\"status\":\"wifi_timeout\",\"ssid\":\"");
                Serial.print(creds[i].ssid);
                Serial.println("\"}");
                WiFi.disconnect();
                break;
            }
            delay(200);
        }

        if (WiFi.status() == WL_CONNECTED) {
            return _postConnect();
        }
    }

    Serial.println("{\"status\":\"wifi_all_failed\"}");
    return false;
}

bool WiFiStream::_postConnect() {
    esp_wifi_set_ps(WIFI_PS_NONE);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);

    Serial.print("{\"status\":\"wifi_connected\",\"ip\":\"");
    Serial.print(WiFi.localIP().toString());
    Serial.print("\",\"ssid\":\"");
    Serial.print(WiFi.SSID());
    Serial.print("\",\"mdns\":\"");
    Serial.print(_hostname);
    Serial.print(".local\",\"wsPort\":");
    Serial.print(_wsPort);
    Serial.println("}");

    if (MDNS.begin(_hostname)) {
        MDNS.addService("ws", "tcp", _wsPort);
    }

    _ws.begin();
    _ws.onEvent(&WiFiStream::_onEventStatic);

    return true;
}

void WiFiStream::update() {
    _ws.loop();

    if (_pendingConnected) {
        _pendingConnected = false;
        if (_onClientConnected) _onClientConnected();
    }
}

void WiFiStream::sendData(const char* line) {
    if (_ws.connectedClients() == 0) return;
    _ws.broadcastTXT(line);
}

void WiFiStream::println(const String& line) {
    println(line.c_str());
}

void WiFiStream::println(const char* line) {
    if (_ws.connectedClients() == 0) return;
    _ws.broadcastTXT(line);
}

void WiFiStream::setClientConnectedCallback(std::function<void()> cb) {
    _onClientConnected = cb;
}

String WiFiStream::readLine() {
    if (_pendingCmd.length() == 0) return "";
    String out = _pendingCmd;
    _pendingCmd = "";
    return out;
}

void WiFiStream::_onEventStatic(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
    if (_instance) _instance->_onEvent(num, type, payload, length);
}

void WiFiStream::_onEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED: {
            IPAddress ip = _ws.remoteIP(num);
            Serial.print("{\"status\":\"ws_client_connected\",\"clientIP\":\"");
            Serial.print(ip.toString());
            Serial.print("\",\"num\":");
            Serial.print(num);
            Serial.println("}");
            _pendingConnected = true;
            break;
        }
        case WStype_DISCONNECTED:
            Serial.print("{\"status\":\"ws_client_disconnected\",\"num\":");
            Serial.print(num);
            Serial.println("}");
            break;

        case WStype_TEXT: {
            // WebSocket frames are already message-framed, so the whole
            // payload is one command. Strip trailing newlines defensively.
            if (length > 0 && _pendingCmd.length() == 0) {
                _pendingCmd.reserve(length);
                for (size_t i = 0; i < length; ++i) {
                    char c = (char)payload[i];
                    if (c == '\n' || c == '\r') continue;
                    _pendingCmd += c;
                }
            }
            break;
        }
        default:
            break;
    }
}
