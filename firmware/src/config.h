#pragma once

// ---------------------------------------------------------------------------
// HX711 pin assignments — 4 load cell corners
//
// Corner layout (viewed from above):
//   f0 = front-left    f1 = front-right
//   f2 = back-left     f3 = back-right
// ---------------------------------------------------------------------------

#define HX711_DOUT_0  16    // Front-left  DATA
#define HX711_CLK_0    4    // Front-left  CLK

#define HX711_DOUT_1  17    // Front-right DATA
#define HX711_CLK_1    5    // Front-right CLK

#define HX711_DOUT_2  25    // Back-left   DATA
#define HX711_CLK_2   18    // Back-left   CLK

#define HX711_DOUT_3  26    // Back-right  DATA
#define HX711_CLK_3   19    // Back-right  CLK

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

// HX711 RATE pin tied HIGH → 80 SPS hardware rate.
// We target 40 Hz in firmware to allow for processing headroom.
#define SAMPLE_RATE_HZ   40
#define SAMPLE_PERIOD_US (1000000 / SAMPLE_RATE_HZ)   // 25 000 µs

// ---------------------------------------------------------------------------
// Serial
// ---------------------------------------------------------------------------
#define SERIAL_BAUD  115200

// ---------------------------------------------------------------------------
// WiFi / TCP (optional)
// ---------------------------------------------------------------------------
#define WIFI_TCP_PORT    8888
#define WIFI_HOSTNAME    "force-plate"   // reachable as force-plate.local via mDNS

// ---------------------------------------------------------------------------
// Load cell connectivity (overridable via loadcell_config.h)
// ---------------------------------------------------------------------------
// How many of the 4 HX711 channels have a physical load cell wired up.
// Set LOADCELLS_CONNECTED_COUNT to the actual count in loadcell_config.h.
// The firmware broadcasts this on startup so the dashboard can show status.
#define LOADCELLS_CONNECTED_COUNT  0
#define LOADCELLS_CHANNEL_COUNT    4

// ---------------------------------------------------------------------------
// Force plate geometry
// ---------------------------------------------------------------------------
// Straight-line distance between left and right cell mounting points (mm)
#define PLATE_WIDTH_MM   500
// Straight-line distance between front and back cell mounting points (mm)
#define PLATE_HEIGHT_MM  500
