#include "bmi323.h"
#include "config.h"

BMI323::BMI323(uint8_t csPin, SPIClass& spi)
    : _csPin(csPin)
    , _spi(spi)
    , _spiSettings(BMI323_SPI_SPEED, MSBFIRST, SPI_MODE0)
{
}

bool BMI323::begin() {
    pinMode(_csPin, OUTPUT);
    digitalWrite(_csPin, HIGH);

    // BMI323 requires a dummy SPI read after power-on to activate SPI mode.
    // Per datasheet: perform a dummy read of register 0x00.
    readRegister(BMI323_REG_CHIP_ID);
    delay(2);

    // Soft reset
    writeRegister(BMI323_REG_CMD, BMI323_CMD_SOFT_RESET);
    delay(100);  // Wait for reset to complete

    // Another dummy read after reset to re-activate SPI interface
    readRegister(BMI323_REG_CHIP_ID);
    delay(2);

    // Verify chip ID
    uint16_t chipId = readChipID();
    if (chipId != BMI323_CHIP_ID_VALUE) {
        return false;
    }

    // Configure accelerometer: 100Hz ODR, +/-4g range, normal mode
    writeRegister(BMI323_REG_ACC_CONF, BMI323_ACC_CONF_VALUE);
    delay(2);

    // Configure gyroscope: 100Hz ODR, +/-2000 deg/s range, normal mode
    writeRegister(BMI323_REG_GYR_CONF, BMI323_GYR_CONF_VALUE);
    delay(2);

    return true;
}

bool BMI323::readData(BMI323Data& data) {
    // Burst read 6 registers starting at ACC_DATA_X (0x03 through 0x08)
    uint16_t buffer[6];
    burstRead(BMI323_REG_ACC_DATA_X, buffer, 6);

    data.acc_x = (int16_t)buffer[0];
    data.acc_y = (int16_t)buffer[1];
    data.acc_z = (int16_t)buffer[2];
    data.gyr_x = (int16_t)buffer[3];
    data.gyr_y = (int16_t)buffer[4];
    data.gyr_z = (int16_t)buffer[5];

    return true;
}

uint16_t BMI323::readChipID() {
    return readRegister(BMI323_REG_CHIP_ID);
}

uint16_t BMI323::readRegister(uint8_t reg) {
    uint16_t value;

    _spi.beginTransaction(_spiSettings);
    digitalWrite(_csPin, LOW);

    // Send read command: bit 7 set = read
    _spi.transfer(reg | 0x80);

    // BMI323 SPI protocol: first 16 bits after address are dummy
    _spi.transfer(0x00);  // dummy byte 1
    _spi.transfer(0x00);  // dummy byte 2

    // Read 16-bit register value (LSB first)
    uint8_t lsb = _spi.transfer(0x00);
    uint8_t msb = _spi.transfer(0x00);
    value = ((uint16_t)msb << 8) | lsb;

    digitalWrite(_csPin, HIGH);
    _spi.endTransaction();

    return value;
}

void BMI323::writeRegister(uint8_t reg, uint16_t value) {
    _spi.beginTransaction(_spiSettings);
    digitalWrite(_csPin, LOW);

    // Send write command: bit 7 clear = write
    _spi.transfer(reg & 0x7F);

    // Write 16-bit value (LSB first)
    _spi.transfer(value & 0xFF);
    _spi.transfer((value >> 8) & 0xFF);

    digitalWrite(_csPin, HIGH);
    _spi.endTransaction();
}

void BMI323::burstRead(uint8_t reg, uint16_t* buffer, uint8_t count) {
    _spi.beginTransaction(_spiSettings);
    digitalWrite(_csPin, LOW);

    // Send read command
    _spi.transfer(reg | 0x80);

    // Dummy bytes (16 bits for BMI323 SPI)
    _spi.transfer(0x00);
    _spi.transfer(0x00);

    // Read count x 16-bit values
    for (uint8_t i = 0; i < count; i++) {
        uint8_t lsb = _spi.transfer(0x00);
        uint8_t msb = _spi.transfer(0x00);
        buffer[i] = ((uint16_t)msb << 8) | lsb;
    }

    digitalWrite(_csPin, HIGH);
    _spi.endTransaction();
}
