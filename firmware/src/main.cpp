#include <Arduino.h>
#include <SPI.h>
#include "config.h"
#include "bmi323.h"

// WiFi streaming — only enabled when wifi_config.h exists.
// Copy wifi_config.h.example → wifi_config.h and fill in credentials.
#if __has_include("wifi_config.h")
  #include "wifi_config.h"
  #include "wifi_stream.h"
  #define WIFI_ENABLED 1
  static WiFiStream wifiStream(WIFI_TCP_PORT, WIFI_HOSTNAME);
#endif

BMI323 imu(BMI323_CS_PIN);
unsigned long lastSampleTime = 0;

// Broadcast a JSON line to all active output channels (Serial + WiFi TCP).
static inline void broadcast(const String& line) {
    Serial.println(line);
#ifdef WIFI_ENABLED
    wifiStream.println(line);
#endif
}

void setup() {
    Serial.begin(SERIAL_BAUD_RATE);
    SPI.begin(BMI323_SCK_PIN, BMI323_MISO_PIN, BMI323_MOSI_PIN, BMI323_CS_PIN);
    delay(500);

#ifdef WIFI_ENABLED
    wifiStream.begin(WIFI_SSID, WIFI_PASSWORD);
#endif

    if (!imu.begin()) {
        broadcast("{\"status\":\"error\",\"msg\":\"bmi323 init failed\"}");
        while (true) { delay(1000); }
    }

    broadcast("{\"status\":\"ready\",\"sensor\":\"bmi323\",\"rate\":100}");
    lastSampleTime = micros();
}

void loop() {
#ifdef WIFI_ENABLED
    // Accept new TCP clients (non-blocking)
    wifiStream.update();
#endif

    const unsigned long now = micros();
    if (now - lastSampleTime < SAMPLE_PERIOD_US) return;
    lastSampleTime += SAMPLE_PERIOD_US;

    BMI323Data raw;
    if (!imu.readData(raw)) return;

    // Scale to physical units
    const float ax = raw.acc_x * ACCEL_SCALE;
    const float ay = raw.acc_y * ACCEL_SCALE;
    const float az = raw.acc_z * ACCEL_SCALE;
    const float gx = raw.gyr_x * GYRO_SCALE;
    const float gy = raw.gyr_y * GYRO_SCALE;
    const float gz = raw.gyr_z * GYRO_SCALE;

    // Build JSON line into a String, then broadcast to all channels
    String json;
    json.reserve(80);
    json += "{\"t\":";    json += millis();
    json += ",\"ax\":";   json += String(ax, 4);
    json += ",\"ay\":";   json += String(ay, 4);
    json += ",\"az\":";   json += String(az, 4);
    json += ",\"gx\":";   json += String(gx, 2);
    json += ",\"gy\":";   json += String(gy, 2);
    json += ",\"gz\":";   json += String(gz, 2);
    json += "}";

    broadcast(json);
}
