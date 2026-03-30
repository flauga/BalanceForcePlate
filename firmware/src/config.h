#pragma once

// ---- HX711 Pin Configuration ----
// Shared SCK drives all four HX711 clock inputs simultaneously,
// giving <1 µs inter-channel synchronization.
#define HX711_SCK_PIN    18   // Shared clock output → all HX711 SCK pins
#define HX711_DOUT_TL    19   // Top-Left     DOUT input
#define HX711_DOUT_TR    21   // Top-Right    DOUT input
#define HX711_DOUT_BL    22   // Bottom-Left  DOUT input
#define HX711_DOUT_BR    23   // Bottom-Right DOUT input

// ---- HX711 Settings ----
// GAIN_PULSES: 24 data bits + N gain-select pulses after the last data bit.
//   25 = Channel A, gain 128 (recommended for most load cells)
//   26 = Channel B, gain 32
//   27 = Channel A, gain 64
#define HX711_GAIN_PULSES     25
#define HX711_SAMPLE_RATE_HZ  50
#define HX711_TARE_SAMPLES    20    // number of samples averaged for tare

// ---- Sampling ----
#define SAMPLE_PERIOD_US  (1000000 / HX711_SAMPLE_RATE_HZ)

// ---- WiFi AP Mode ----
// The ESP32 creates its own SSID — no external router needed.
// Laptop connects to "ForcePlate_01" and receives IP 192.168.4.2 via DHCP.
#define WIFI_AP_SSID      "ForcePlate_01"
#define WIFI_AP_PASSWORD  ""    // empty = open AP; set a WPA2 password if desired
#define WIFI_AP_CHANNEL   6
#define WIFI_AP_MAX_CONN  1

// ---- UDP Streaming ----
#define UDP_DEST_PORT     12345   // laptop-side receive port
#define UDP_LOCAL_PORT    12344   // ESP32 source port

// ---- State Machine Thresholds ----
#define DETECT_THRESHOLD_KG   5.0f   // F_total must exceed this to begin DETECTING
#define DETECT_DEBOUNCE_MS    500    // hold above threshold this long before RECORDING
#define OFFLOAD_DEBOUNCE_MS   1000   // hold below threshold this long before returning to IDLE

// ---- Ring Buffer ----
// Holds up to 512 packets of 22 bytes = ~11 KB.
// At 50 Hz this covers 10.2 seconds of UDP outage before oldest packets are dropped.
#define RING_BUFFER_ITEMS  512
#define RING_BUFFER_SIZE   (RING_BUFFER_ITEMS * 22)

// ---- Serial (debug only) ----
#define SERIAL_BAUD_RATE  115200

// ---- Load Cell Scale Factors ----
// Default 1.0 = raw ADC counts passed through.
// After calibration, set to (known_mass_grams / raw_reading) for each channel.
// Override in calibration procedure at runtime via setCalibration().
#define DEFAULT_SCALE_CH0   1.0f
#define DEFAULT_SCALE_CH1   1.0f
#define DEFAULT_SCALE_CH2   1.0f
#define DEFAULT_SCALE_CH3   1.0f
