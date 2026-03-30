#pragma once

#include <stdint.h>
#include <string.h>

// ---- Packet constants ----
#define PACKET_SYNC       0xAAu
#define PACKET_TYPE_DATA  0x01u
#define PACKET_TYPE_HB    0x02u
#define PACKET_SIZE       22u

/**
 * 22-byte binary UDP packet (little-endian throughout).
 *
 * Offset  Size  Field       Description
 * ------  ----  ----------  -------------------------------------------
 *  [0]      1   SYNC        0xAA — frame sync marker
 *  [1]      1   TYPE        0x01 = data, 0x02 = heartbeat
 *  [2-3]    2   SEQ         uint16 sequence number (wraps at 65535)
 *  [4-7]    4   TIMESTAMP   uint32 micros() since boot
 *  [8-19]  12   F[0..3]     4 × int24 load cell readings (LE signed)
 *                             F[0]=TL, F[1]=TR, F[2]=BL, F[3]=BR
 *  [20-21]  2   CRC16       CRC-16-CCITT over bytes [0..19] (LE)
 */

// ---- CRC-16-CCITT (poly 0x1021, init 0xFFFF, no input/output reflection) ----
inline uint16_t crc16_ccitt(const uint8_t* data, uint16_t len) {
    uint16_t crc = 0xFFFFu;
    for (uint16_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (uint8_t bit = 0; bit < 8; bit++) {
            if (crc & 0x8000u) {
                crc = (uint16_t)((crc << 1) ^ 0x1021u);
            } else {
                crc = (uint16_t)(crc << 1);
            }
        }
    }
    return crc;
}

// ---- Pack helpers ----

// Write a signed 24-bit value into buf[offset..offset+2] little-endian.
inline void write_int24_le(uint8_t* buf, uint8_t offset, int32_t val) {
    buf[offset]     = (uint8_t)(val & 0xFF);
    buf[offset + 1] = (uint8_t)((val >> 8) & 0xFF);
    buf[offset + 2] = (uint8_t)((val >> 16) & 0xFF);
}

/**
 * Pack a data packet into buf (must be PACKET_SIZE bytes).
 *
 * @param buf   Output buffer (22 bytes)
 * @param seq   Sequence number
 * @param ts    Timestamp from micros()
 * @param f0-f3 Signed 24-bit raw ADC counts: TL, TR, BL, BR
 */
inline void pack_data_packet(uint8_t* buf,
                              uint16_t seq,
                              uint32_t ts,
                              int32_t f0, int32_t f1,
                              int32_t f2, int32_t f3) {
    buf[0] = PACKET_SYNC;
    buf[1] = PACKET_TYPE_DATA;
    buf[2] = (uint8_t)(seq & 0xFF);
    buf[3] = (uint8_t)(seq >> 8);
    buf[4] = (uint8_t)(ts & 0xFF);
    buf[5] = (uint8_t)((ts >> 8) & 0xFF);
    buf[6] = (uint8_t)((ts >> 16) & 0xFF);
    buf[7] = (uint8_t)((ts >> 24) & 0xFF);
    write_int24_le(buf,  8, f0);
    write_int24_le(buf, 11, f1);
    write_int24_le(buf, 14, f2);
    write_int24_le(buf, 17, f3);
    uint16_t crc = crc16_ccitt(buf, 20);
    buf[20] = (uint8_t)(crc & 0xFF);
    buf[21] = (uint8_t)(crc >> 8);
}

/**
 * Pack a heartbeat packet into buf (must be PACKET_SIZE bytes).
 * Load cell fields are zero-filled.
 */
inline void pack_heartbeat_packet(uint8_t* buf, uint16_t seq, uint32_t ts) {
    buf[0] = PACKET_SYNC;
    buf[1] = PACKET_TYPE_HB;
    buf[2] = (uint8_t)(seq & 0xFF);
    buf[3] = (uint8_t)(seq >> 8);
    buf[4] = (uint8_t)(ts & 0xFF);
    buf[5] = (uint8_t)((ts >> 8) & 0xFF);
    buf[6] = (uint8_t)((ts >> 16) & 0xFF);
    buf[7] = (uint8_t)((ts >> 24) & 0xFF);
    memset(buf + 8, 0, 12);  // load cell bytes = 0
    uint16_t crc = crc16_ccitt(buf, 20);
    buf[20] = (uint8_t)(crc & 0xFF);
    buf[21] = (uint8_t)(crc >> 8);
}
