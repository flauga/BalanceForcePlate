#include <Arduino.h>
#include "config.h"
#include "hx711.h"

// Load cell count override — copy loadcell_config.h.example → loadcell_config.h
#if __has_include("loadcell_config.h")
  #include "loadcell_config.h"
#endif

// WiFi streaming — only enabled when wifi_config.h exists.
// Copy wifi_config.h.example → wifi_config.h and fill in credentials.
#if __has_include("wifi_config.h")
  #include "wifi_config.h"
  #include "wifi_stream.h"
  #define WIFI_ENABLED 1
  static WiFiStream wifiStream(WIFI_TCP_PORT, WIFI_HOSTNAME);
#endif

HX711Array sensors(
  HX711_DOUT_0, HX711_CLK_0,
  HX711_DOUT_1, HX711_CLK_1,
  HX711_DOUT_2, HX711_CLK_2,
  HX711_DOUT_3, HX711_CLK_3
);

unsigned long lastSampleTime = 0;

// Streaming state — controlled by "start\n" / "stop\n" commands from the laptop
static bool streaming = false;

// Broadcast a JSON line to all active output channels (Serial + optional WiFi TCP).
static inline void broadcast(const String& line) {
    Serial.println(line);
#ifdef WIFI_ENABLED
    wifiStream.println(line);
#endif
}

// Check for incoming commands over Serial or WiFi TCP.
// Recognised commands: "start" and "stop".
static void checkCommands() {
    // Serial command
    while (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        if (cmd == "start") {
            streaming = true;
            broadcast("{\"status\":\"streaming\"}");
        } else if (cmd == "stop") {
            streaming = false;
            broadcast("{\"status\":\"idle\"}");
        }
    }

#ifdef WIFI_ENABLED
    // WiFi TCP command — delegated to WiFiStream helper
    String cmd = wifiStream.readLine();
    if (cmd.length() > 0) {
        cmd.trim();
        if (cmd == "start") {
            streaming = true;
            broadcast("{\"status\":\"streaming\"}");
        } else if (cmd == "stop") {
            streaming = false;
            broadcast("{\"status\":\"idle\"}");
        }
    }
#endif
}

void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(200);

#ifdef WIFI_ENABLED
    wifiStream.begin(WIFI_SSID, WIFI_PASSWORD);
#endif

    // Initialize and tare load cells (plate must be unloaded during tare)
    broadcast("{\"status\":\"initializing\",\"sensor\":\"hx711\"}");
    sensors.begin();   // configures GPIO + tares all 4 cells

    broadcast("{\"status\":\"ready\",\"sensor\":\"hx711\",\"rate\":" + String(SAMPLE_RATE_HZ) + "}");

    // Broadcast load cell connectivity so the dashboard can show status
    broadcast(
        "{\"status\":\"loadcells_state\","
        "\"connected_count\":" + String(LOADCELLS_CONNECTED_COUNT) + ","
        "\"channel_count\":"   + String(LOADCELLS_CHANNEL_COUNT)   + "}"
    );

    lastSampleTime = micros();
}

void loop() {
#ifdef WIFI_ENABLED
    wifiStream.update();
#endif

    // Process any incoming start/stop commands
    checkCommands();

    // Enforce sample rate
    const unsigned long now = micros();
    if (now - lastSampleTime < SAMPLE_PERIOD_US) return;
    lastSampleTime += SAMPLE_PERIOD_US;

    // Only read and send data when streaming is active
    if (!streaming) return;

    long f[4];
    sensors.readAll(f);

    String json;
    json.reserve(80);
    json += "{\"t\":";   json += millis();
    json += ",\"f0\":";  json += f[0];
    json += ",\"f1\":";  json += f[1];
    json += ",\"f2\":";  json += f[2];
    json += ",\"f3\":";  json += f[3];
    json += "}";

    broadcast(json);
}
