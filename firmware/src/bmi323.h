#pragma once

#include <Arduino.h>
#include <SPI.h>

// ---- BMI323 Register Addresses ----
#define BMI323_REG_CHIP_ID        0x00
#define BMI323_REG_ERR_REG        0x01
#define BMI323_REG_STATUS         0x02
#define BMI323_REG_ACC_DATA_X     0x03
#define BMI323_REG_ACC_DATA_Y     0x04
#define BMI323_REG_ACC_DATA_Z     0x05
#define BMI323_REG_GYR_DATA_X     0x06
#define BMI323_REG_GYR_DATA_Y     0x07
#define BMI323_REG_GYR_DATA_Z     0x08
#define BMI323_REG_TEMP_DATA      0x09
#define BMI323_REG_SENSOR_TIME_0  0x0A
#define BMI323_REG_SENSOR_TIME_1  0x0B
#define BMI323_REG_INT_STATUS_1   0x0D
#define BMI323_REG_INT_STATUS_2   0x0E
#define BMI323_REG_ACC_CONF       0x20
#define BMI323_REG_GYR_CONF       0x21
#define BMI323_REG_IO_INT_CTRL    0x38
#define BMI323_REG_INT_MAP_1      0x3A
#define BMI323_REG_INT_MAP_2      0x3B
#define BMI323_REG_CMD            0x7E

// ---- BMI323 Expected Chip ID ----
#define BMI323_CHIP_ID_VALUE      0x0043

// ---- BMI323 Commands ----
#define BMI323_CMD_SOFT_RESET     0xDEAF

// ---- Accel/Gyro Configuration Bits ----
// ODR: bits [3:0], Range: bits [6:4], Mode: bits [14:12]
// ODR 100Hz = 0x08, Range +-4g = 0x01 (accel), Range +-2000dps = 0x04 (gyro)
// Mode: Normal = 0x4 (bits 14:12)
// ACC_CONF: mode=normal(0x4000) | range=4g(0x0010) | odr=100Hz(0x0008) = 0x4018
// GYR_CONF: mode=normal(0x4000) | range=2000(0x0040) | odr=100Hz(0x0008) = 0x4048
#define BMI323_ACC_CONF_VALUE     0x4018
#define BMI323_GYR_CONF_VALUE     0x4048

struct BMI323Data {
    int16_t acc_x;
    int16_t acc_y;
    int16_t acc_z;
    int16_t gyr_x;
    int16_t gyr_y;
    int16_t gyr_z;
};

class BMI323 {
public:
    BMI323(uint8_t csPin, SPIClass& spi = SPI);

    // Initialize the sensor. Returns true on success.
    bool begin();

    // Read all 6 axes (accel + gyro) in a single burst.
    bool readData(BMI323Data& data);

    // Read chip ID for verification.
    uint16_t readChipID();

private:
    uint8_t _csPin;
    SPIClass& _spi;
    SPISettings _spiSettings;

    // BMI323 uses 16-bit register reads/writes.
    // SPI read: first byte after address is dummy.
    uint16_t readRegister(uint8_t reg);
    void writeRegister(uint8_t reg, uint16_t value);

    // Burst read multiple 16-bit registers starting at reg.
    void burstRead(uint8_t reg, uint16_t* buffer, uint8_t count);
};
