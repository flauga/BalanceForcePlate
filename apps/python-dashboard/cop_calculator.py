"""
cop_calculator.py — Center-of-Pressure (COP) computation and balance metrics.

Coordinate system (viewed from above, subject facing +Y direction):
    COP_x  mediolateral (left–right),  positive = right
    COP_y  anteroposterior (back–front), positive = forward

Corner labeling:
    TL = top-left    (index 0)   — back-left
    TR = top-right   (index 1)   — back-right
    BL = bottom-left (index 2)   — front-left
    BR = bottom-right (index 3)  — front-right

COP formulae (standard posturography convention):
    COP_x = a × (F_TR + F_BR − F_TL − F_BL) / F_total
    COP_y = b × (F_TL + F_TR − F_BL − F_BR) / F_total

where a = plate half-width (mm), b = plate half-height (mm).
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from typing import Optional


# ---- Per-sample result ----

@dataclass
class COPFrame:
    timestamp_us: int
    seq:          int
    f:            tuple         # (F_TL, F_TR, F_BL, F_BR) in Newtons
    f_total:      float         # sum of all four forces (N)
    cop_x:        float         # mm (0.0 when below guard threshold)
    cop_y:        float         # mm (0.0 when below guard threshold)
    cop_valid:    bool          # False when f_total < guard threshold


# ---- Per-session rolling metrics ----

@dataclass
class COPMetrics:
    path_mm:        float = 0.0    # total sway path length (mm)
    mean_vel_mm_s:  float = 0.0    # mean sway velocity (mm/s)
    ellipse_area:   float = 0.0    # 95% confidence ellipse area (mm²)
    rms_x:          float = 0.0    # RMS of COP_x excursion (mm)
    rms_y:          float = 0.0    # RMS of COP_y excursion (mm)
    n_samples:      int   = 0


# ---- Calculator ----

class COPCalculator:
    """
    Converts raw HX711 ADC counts to COP coordinates.

    Parameters
    ----------
    half_width_mm   Plate half-dimension along X axis (mm).  Default 200 mm.
    half_height_mm  Plate half-dimension along Y axis (mm).  Default 200 mm.
    guard_fraction  Fraction of body weight; COP is only computed when
                    F_total > guard_fraction × body_weight_kg × g.  Default 0.05.
    body_weight_kg  Subject body weight used for guard threshold.  Default 70 kg.
    """

    def __init__(
        self,
        half_width_mm:  float = 200.0,
        half_height_mm: float = 200.0,
        guard_fraction: float = 0.05,
        body_weight_kg: float = 70.0,
    ) -> None:
        self.a = half_width_mm
        self.b = half_height_mm
        self._guard_N = guard_fraction * body_weight_kg * 9.81
        # Per-channel scale: N per raw ADC count.  1.0 = pass-through (uncalibrated).
        self._scale: list[float] = [1.0, 1.0, 1.0, 1.0]

    def set_scale(self, channel: int, newtons_per_count: float) -> None:
        """Set force scale for one channel (0=TL, 1=TR, 2=BL, 3=BR)."""
        if 0 <= channel < 4:
            self._scale[channel] = newtons_per_count

    def compute(self, raw: tuple, ts_us: int, seq: int) -> COPFrame:
        """
        Convert one raw 4-channel reading into a COPFrame.

        Parameters
        ----------
        raw     Tuple of four int24 ADC counts (TL, TR, BL, BR).
        ts_us   Timestamp in microseconds from ESP32 micros().
        seq     Packet sequence number.
        """
        f = tuple(raw[i] * self._scale[i] for i in range(4))
        f_total = f[0] + f[1] + f[2] + f[3]

        if f_total > self._guard_N:
            cop_x = self.a * (f[1] + f[3] - f[0] - f[2]) / f_total
            cop_y = self.b * (f[0] + f[1] - f[2] - f[3]) / f_total
            valid = True
        else:
            cop_x = 0.0
            cop_y = 0.0
            valid = False

        return COPFrame(
            timestamp_us=ts_us,
            seq=seq,
            f=f,
            f_total=f_total,
            cop_x=cop_x,
            cop_y=cop_y,
            cop_valid=valid,
        )


# ---- Metrics calculator ----

class MetricsCalculator:
    """
    Computes posturographic metrics from a window of COP samples.

    All inputs are numpy arrays of equal length (valid COP points only).
    """

    @staticmethod
    def compute(
        cop_x: np.ndarray,
        cop_y: np.ndarray,
        sample_rate: float,
    ) -> COPMetrics:
        """
        Parameters
        ----------
        cop_x, cop_y  Arrays of COP coordinates in mm (only valid frames).
        sample_rate   Actual sampling rate in Hz (used for velocity calc).

        Returns COPMetrics with all fields populated (zeros if n < 3).
        """
        n = len(cop_x)
        if n < 3:
            return COPMetrics(n_samples=n)

        # ---- Path length ----
        dx = np.diff(cop_x)
        dy = np.diff(cop_y)
        path = float(np.sum(np.sqrt(dx * dx + dy * dy)))

        # ---- Mean sway velocity ----
        duration = n / sample_rate if sample_rate > 0 else 0.0
        mean_vel = path / duration if duration > 0 else 0.0

        # ---- 95% confidence ellipse area ----
        # Using the eigenvalue decomposition of the 2×2 covariance matrix.
        # Area = π × χ²(0.95, df=2) × √(λ₁ × λ₂)
        # χ²(0.95, 2) = 5.991
        cov = np.cov(np.stack([cop_x, cop_y]))
        # eigvalsh is stable for symmetric real matrices.
        evals = np.linalg.eigvalsh(cov)
        product = float(evals[0] * evals[1])
        ellipse_area = np.pi * 5.991 * np.sqrt(max(product, 0.0))

        # ---- RMS ----
        rms_x = float(np.sqrt(np.mean(cop_x ** 2)))
        rms_y = float(np.sqrt(np.mean(cop_y ** 2)))

        return COPMetrics(
            path_mm=path,
            mean_vel_mm_s=mean_vel,
            ellipse_area=ellipse_area,
            rms_x=rms_x,
            rms_y=rms_y,
            n_samples=n,
        )
