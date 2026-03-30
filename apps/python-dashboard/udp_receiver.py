"""
udp_receiver.py — daemon UDP receiver thread for the Force Plate dashboard.

Listens on 0.0.0.0:<port> for 22-byte binary packets from the ESP32.

Packet layout (matches firmware packet.h):
  [0]    SYNC   0xAA
  [1]    TYPE   0x01 = data, 0x02 = heartbeat
  [2-3]  SEQ    uint16 LE
  [4-7]  TS     uint32 LE (micros since boot)
  [8-19] F0-F3  4 × int24 LE (raw ADC counts: TL, TR, BL, BR)
  [20-21] CRC16 CRC-16-CCITT over bytes 0-19 (LE)
"""

import socket
import threading
import queue
import time
from collections import deque
from typing import NamedTuple, Optional


# ---- Packet constants ----

PACKET_SIZE = 22
SYNC_BYTE   = 0xAA
TYPE_DATA   = 0x01
TYPE_HB     = 0x02
CRC_POLY    = 0x1021
CRC_INIT    = 0xFFFF


# ---- Parsed packet ----

class DataPacket(NamedTuple):
    type:   int           # TYPE_DATA or TYPE_HB
    seq:    int           # 0–65535
    ts_us:  int           # micros() from ESP32
    raw:    tuple         # (F_TL, F_TR, F_BL, F_BR) raw ADC counts (int24)
    rx_time: float        # time.monotonic() at receipt


# ---- CRC-16-CCITT ----
# Polynomial 0x1021, initial value 0xFFFF, no input/output bit reflection.
# Must match firmware crc16_ccitt() exactly.

def crc16_ccitt(data: bytes) -> int:
    crc = CRC_INIT
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ CRC_POLY) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


# ---- int24 little-endian sign extension ----

def _unpack_int24_le(data: bytes, offset: int) -> int:
    v = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16)
    return v - 0x1000000 if v >= 0x800000 else v


# ---- UDPReceiver ----

class UDPReceiver:
    """
    Daemon thread that receives, validates, and parses 22-byte packets.

    Usage:
        pkt_queue = queue.Queue()
        rx = UDPReceiver(port=12345, out_queue=pkt_queue)
        rx.start()
        while True:
            pkt = pkt_queue.get()
            # use pkt.raw, pkt.seq, pkt.ts_us …

    Properties (thread-safe reads):
        connected    — True if a valid packet arrived within the last 3 s
        drop_count   — cumulative lost packets (sequence gaps)
        crc_errors   — cumulative CRC failures
        sample_rate  — estimated Hz over the last 1 s window
    """

    def __init__(self, port: int, out_queue: queue.Queue) -> None:
        self._port      = port
        self._queue     = out_queue
        self._stop_evt  = threading.Event()

        # Stats (written only by receiver thread; reads are best-effort atomic)
        self._drop_count   = 0
        self._crc_errors   = 0
        self._last_seq: Optional[int] = None
        self._last_rx_time = 0.0

        # Rolling sample-rate estimator: timestamps of the last 1 s of packets
        self._rate_window: deque = deque()

        self._thread = threading.Thread(
            target=self._recv_loop,
            name='udp-receiver',
            daemon=True,
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_evt.set()
        self._thread.join(timeout=2.0)

    # ---- Public properties ----

    @property
    def connected(self) -> bool:
        return (time.monotonic() - self._last_rx_time) < 3.0

    @property
    def drop_count(self) -> int:
        return self._drop_count

    @property
    def crc_errors(self) -> int:
        return self._crc_errors

    @property
    def sample_rate(self) -> float:
        """Estimated packets/second over the last 1-second sliding window."""
        now = time.monotonic()
        while self._rate_window and (now - self._rate_window[0]) > 1.0:
            self._rate_window.popleft()
        return float(len(self._rate_window))

    # ---- Internal receive loop ----

    def _recv_loop(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(0.5)   # unblock every 0.5 s to check stop_evt
        sock.bind(('0.0.0.0', self._port))

        while not self._stop_evt.is_set():
            try:
                data, _addr = sock.recvfrom(64)
            except socket.timeout:
                continue
            except OSError:
                # Socket closed externally; exit cleanly.
                break

            pkt = self._parse(data)
            if pkt is not None:
                self._last_rx_time = pkt.rx_time
                self._rate_window.append(pkt.rx_time)
                self._queue.put(pkt)

        sock.close()

    def _parse(self, data: bytes) -> Optional[DataPacket]:
        """Return a DataPacket or None if the datagram is invalid."""
        if len(data) != PACKET_SIZE:
            return None

        # Sync byte check
        if data[0] != SYNC_BYTE:
            return None

        # CRC check (over first 20 bytes)
        expected_crc = crc16_ccitt(data[:20])
        actual_crc   = data[20] | (data[21] << 8)
        if expected_crc != actual_crc:
            self._crc_errors += 1
            return None

        pkt_type = data[1]
        seq      = data[2] | (data[3] << 8)
        ts_us    = (data[4] | (data[5] << 8) |
                    (data[6] << 16) | (data[7] << 24))

        raw_f = (
            _unpack_int24_le(data,  8),
            _unpack_int24_le(data, 11),
            _unpack_int24_le(data, 14),
            _unpack_int24_le(data, 17),
        )

        # Sequence gap detection
        if self._last_seq is not None:
            gap = (seq - self._last_seq - 1) & 0xFFFF
            if gap > 0:
                self._drop_count += gap
        self._last_seq = seq

        return DataPacket(
            type=pkt_type,
            seq=seq,
            ts_us=ts_us,
            raw=raw_f,
            rx_time=time.monotonic(),
        )
