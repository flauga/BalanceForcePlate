"""
dashboard.py — PyQt6 + pyqtgraph real-time Force Plate dashboard.

Layout
------
┌─────────────────────────────────────────────────────────────┐
│  Status bar: connection · packet-loss · sample rate         │
├──────────────────────────────┬──────────────────────────────┤
│  COP scatter plot (square)   │  Force time series (4 ch)    │
│  + 95% ellipse overlay       │  10-second rolling window    │
│  + plate boundary rect       │                              │
├──────────────────────────────┴──────────────────────────────┤
│  Metrics: path · velocity · ellipse area · RMS              │
├─────────────────────────────────────────────────────────────┤
│  [Start/Stop]  Duration: [30 ▲▼] s   [Export CSV]          │
└─────────────────────────────────────────────────────────────┘
"""

from __future__ import annotations

import configparser
import csv
import queue
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pyqtgraph as pg
from PyQt6.QtCore import QTimer, Qt
from PyQt6.QtGui import QColor, QPalette
from PyQt6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
    QFileDialog,
    QMessageBox,
)

from cop_calculator import COPCalculator, COPFrame, MetricsCalculator
from udp_receiver import TYPE_DATA, UDPReceiver

# ---- Constants ----

TRAIL_LEN    = 1500   # COP trail points = 30 s at 50 Hz
FORCE_WIN    = 500    # force time-series window = 10 s at 50 Hz
METRIC_TICK  = 500    # metric label refresh interval (ms)
ELLIPSE_TICK = 1000   # ellipse recompute interval (ms)


# ---- Session logger ----

class _SessionLogger:
    HEADER = [
        'timestamp_us', 'seq',
        'F_TL_N', 'F_TR_N', 'F_BL_N', 'F_BR_N', 'F_total_N',
        'COP_x_mm', 'COP_y_mm',
        'session_id',
    ]

    def __init__(self, output_dir: str) -> None:
        self._dir = Path(output_dir).expanduser()
        self._dir.mkdir(parents=True, exist_ok=True)
        self._session_id: Optional[str] = None
        self._writer = None
        self._file   = None
        self._path: Optional[Path] = None

    def start_session(self) -> Path:
        self._session_id = str(uuid.uuid4())[:8]
        ts   = datetime.now().strftime('%Y%m%d_%H%M%S')
        self._path = self._dir / f'fp_{ts}_{self._session_id}.csv'
        self._file = open(self._path, 'w', newline='')
        self._writer = csv.writer(self._file)
        self._writer.writerow(self.HEADER)
        return self._path

    def log_frame(self, frame: COPFrame) -> None:
        if self._writer is None:
            return
        self._writer.writerow([
            frame.timestamp_us,
            frame.seq,
            f'{frame.f[0]:.4f}',
            f'{frame.f[1]:.4f}',
            f'{frame.f[2]:.4f}',
            f'{frame.f[3]:.4f}',
            f'{frame.f_total:.4f}',
            f'{frame.cop_x:.3f}',
            f'{frame.cop_y:.3f}',
            self._session_id,
        ])

    def end_session(self) -> Optional[Path]:
        if self._file:
            self._file.flush()
            self._file.close()
            self._file   = None
            self._writer = None
        return self._path


# ---- Simulator (--simulate mode) ----

class _Simulator:
    """
    Generates synthetic COP data (random walk + slow drift) without hardware.
    Pushes DataPacket-compatible dicts into `out_queue` at ~50 Hz.
    """

    def __init__(self, out_queue: queue.Queue) -> None:
        self._queue = out_queue
        self._stop  = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name='simulator', daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2.0)

    # fake stats
    connected    = True
    drop_count   = 0
    crc_errors   = 0

    @property
    def sample_rate(self) -> float:
        return 50.0

    def _run(self) -> None:
        from udp_receiver import DataPacket, TYPE_DATA
        seq    = 0
        cop_x  = 0.0
        cop_y  = 0.0
        t_start = time.monotonic()
        interval = 1.0 / 50.0

        while not self._stop.is_set():
            t_now = time.monotonic()
            elapsed = t_now - t_start

            # slow drift + Gaussian step
            cop_x += np.random.normal(0, 0.5) + 0.02 * np.sin(elapsed * 0.3)
            cop_y += np.random.normal(0, 0.5) + 0.02 * np.cos(elapsed * 0.25)
            # clamp to ±150 mm
            cop_x = max(-150.0, min(150.0, cop_x))
            cop_y = max(-150.0, min(150.0, cop_y))

            # back-convert COP to fake raw counts (a=b=200 mm)
            # COP_x = 200 * (TR+BR-TL-BL)/Ftot  → keep Ftot = 80 kg * 9.81 N
            f_total_N = 80.0 * 9.81
            # TL=BL same, TR=BR same; imbalance drives COP_x
            right = (cop_x / 200.0 + 1.0) * f_total_N / 2.0   # TR+BR
            left  = f_total_N - right                           # TL+BL
            top   = (cop_y / 200.0 + 1.0) * f_total_N / 2.0
            bot   = f_total_N - top
            # corners split equally left/right and top/bottom
            f_tl = int(left  / 2)
            f_tr = int(right / 2)
            f_bl = int(left  / 2)
            f_br = int(right / 2)

            pkt = DataPacket(
                type=TYPE_DATA,
                seq=seq & 0xFFFF,
                ts_us=int(elapsed * 1e6),
                raw=(f_tl, f_tr, f_bl, f_br),
                rx_time=t_now,
            )
            self._queue.put(pkt)
            seq += 1
            time.sleep(max(0.0, interval - (time.monotonic() - t_now)))


# ---- Main dashboard window ----

class ForcePlateDashboard(QMainWindow):

    def __init__(
        self,
        cfg: configparser.ConfigParser,
        simulate: bool = False,
    ) -> None:
        super().__init__()
        self._cfg      = cfg
        self._simulate = simulate

        # ---- Config ----
        self._plate_a  = cfg.getfloat('plate', 'half_width_mm',  fallback=200.0)
        self._plate_b  = cfg.getfloat('plate', 'half_height_mm', fallback=200.0)
        self._bw_kg    = cfg.getfloat('plate', 'body_weight_kg', fallback=70.0)
        self._guard    = cfg.getfloat('session', 'cop_guard_fraction', fallback=0.05)
        self._udp_port = cfg.getint('network',  'udp_port',      fallback=12345)
        self._dur_s    = cfg.getint('session',  'default_duration_s', fallback=30)
        self._out_dir  = cfg.get('logging',     'output_dir',    fallback='~/force-plate-sessions')

        # ---- COP calculator ----
        self._cop_calc = COPCalculator(
            half_width_mm=self._plate_a,
            half_height_mm=self._plate_b,
            guard_fraction=self._guard,
            body_weight_kg=self._bw_kg,
        )

        # ---- Data structures ----
        self._pkt_queue: queue.Queue = queue.Queue()
        self._cop_trail_x: deque = deque(maxlen=TRAIL_LEN)
        self._cop_trail_y: deque = deque(maxlen=TRAIL_LEN)
        self._force_buf = [deque(maxlen=FORCE_WIN) for _ in range(4)]
        self._frames_session: list = []    # COPFrame list for current session

        # ---- Session state ----
        self._recording    = False
        self._session_start: Optional[float] = None
        self._logger = _SessionLogger(self._out_dir)

        # ---- UDP receiver / simulator ----
        if simulate:
            self._source = _Simulator(self._pkt_queue)
        else:
            self._source = UDPReceiver(self._udp_port, self._pkt_queue)
        self._source.start()

        # ---- Build UI ----
        self._build_ui()

        # ---- Timers ----
        self._update_timer = QTimer(self)
        self._update_timer.timeout.connect(self._on_update_tick)
        self._update_timer.start(20)   # 50 fps

        self._metric_timer = QTimer(self)
        self._metric_timer.timeout.connect(self._on_metric_tick)
        self._metric_timer.start(METRIC_TICK)

        self._ellipse_timer = QTimer(self)
        self._ellipse_timer.timeout.connect(self._on_ellipse_tick)
        self._ellipse_timer.start(ELLIPSE_TICK)

    # ====================================================================
    # UI construction
    # ====================================================================

    def _build_ui(self) -> None:
        pg.setConfigOption('background', '#1e1e2e')
        pg.setConfigOption('foreground', '#cdd6f4')

        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setSpacing(6)

        # ---- Status bar ----
        status_row = QHBoxLayout()
        self._lbl_ssid       = QLabel('ForcePlate_01')
        self._lbl_conn       = QLabel('●  Disconnected')
        self._lbl_conn.setStyleSheet('color: #f38ba8; font-weight: bold;')
        self._lbl_loss       = QLabel('Packet loss: 0')
        self._lbl_rate       = QLabel('Rate: — Hz')
        self._lbl_mode       = QLabel('[SIMULATE]' if self._simulate else '')
        self._lbl_mode.setStyleSheet('color: #fab387;')
        for w in (self._lbl_ssid, self._lbl_conn,
                  self._lbl_loss, self._lbl_rate, self._lbl_mode):
            status_row.addWidget(w)
        status_row.addStretch()
        root.addLayout(status_row)

        # ---- Plots row ----
        plots_row = QHBoxLayout()

        # Left: COP scatter
        self._cop_plot = pg.PlotWidget(title='Center of Pressure')
        self._cop_plot.setAspectLocked(True)
        self._cop_plot.setXRange(-self._plate_a, self._plate_a)
        self._cop_plot.setYRange(-self._plate_b, self._plate_b)
        self._cop_plot.setLabel('left',   'COP Y (mm)')
        self._cop_plot.setLabel('bottom', 'COP X (mm)')
        self._cop_plot.showGrid(x=True, y=True, alpha=0.3)

        # Plate boundary rectangle
        rect = pg.QtWidgets.QGraphicsRectItem(
            -self._plate_a, -self._plate_b,
            2 * self._plate_a, 2 * self._plate_b
        )
        rect.setPen(pg.mkPen('#585b70', width=1))
        self._cop_plot.addItem(rect)

        # Trail line + current marker
        self._cop_trail_item = self._cop_plot.plot(
            [], [],
            pen=pg.mkPen('#89b4fa', width=1),
            antialias=True,
        )
        self._cop_marker = self._cop_plot.plot(
            [], [],
            symbol='o',
            symbolSize=8,
            symbolBrush='#f38ba8',
            pen=None,
        )

        # Ellipse overlay (initially empty)
        self._ellipse_item = self._cop_plot.plot(
            [], [],
            pen=pg.mkPen('#a6e3a1', width=1, style=Qt.PenStyle.DashLine),
        )

        plots_row.addWidget(self._cop_plot, stretch=1)

        # Right: 4-channel force time series
        gl = pg.GraphicsLayoutWidget(title='Load Cell Forces')
        self._force_plots: list = []
        self._force_curves: list = []
        colors = ['#f38ba8', '#a6e3a1', '#89b4fa', '#fab387']
        labels = ['TL', 'TR', 'BL', 'BR']
        for i in range(4):
            p = gl.addPlot(row=i, col=0)
            p.setLabel('left', labels[i])
            p.showGrid(x=False, y=True, alpha=0.3)
            p.hideAxis('bottom')
            if i == 3:
                p.showAxis('bottom')
                p.setLabel('bottom', 'samples')
            curve = p.plot(pen=pg.mkPen(colors[i], width=1))
            self._force_plots.append(p)
            self._force_curves.append(curve)

        plots_row.addWidget(gl, stretch=1)
        root.addLayout(plots_row)

        # ---- Metrics row ----
        metrics_row = QHBoxLayout()
        self._lbl_path  = self._metric_label('Path: — mm')
        self._lbl_vel   = self._metric_label('Velocity: — mm/s')
        self._lbl_area  = self._metric_label('Ellipse area: — mm²')
        self._lbl_rms   = self._metric_label('RMS x/y: —/— mm')
        for w in (self._lbl_path, self._lbl_vel, self._lbl_area, self._lbl_rms):
            metrics_row.addWidget(w)
        metrics_row.addStretch()
        root.addLayout(metrics_row)

        # ---- Controls row ----
        ctrl_row = QHBoxLayout()

        self._btn_start = QPushButton('Start Recording')
        self._btn_start.setCheckable(True)
        self._btn_start.clicked.connect(self._on_start_stop)
        self._btn_start.setStyleSheet(
            'QPushButton { background: #313244; padding: 6px 14px; }'
            'QPushButton:checked { background: #a6e3a1; color: #1e1e2e; font-weight: bold; }'
        )

        dur_label = QLabel('Duration:')
        self._spin_dur = QSpinBox()
        self._spin_dur.setRange(5, 300)
        self._spin_dur.setValue(self._dur_s)
        self._spin_dur.setSuffix(' s')

        self._btn_export = QPushButton('Export CSV')
        self._btn_export.clicked.connect(self._on_export)
        self._btn_export.setEnabled(False)

        ctrl_row.addWidget(self._btn_start)
        ctrl_row.addWidget(dur_label)
        ctrl_row.addWidget(self._spin_dur)
        ctrl_row.addWidget(self._btn_export)
        ctrl_row.addStretch()
        root.addLayout(ctrl_row)

    @staticmethod
    def _metric_label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet(
            'background: #313244; border-radius: 4px; padding: 4px 10px;'
            'color: #cdd6f4; font-family: monospace;'
        )
        return lbl

    # ====================================================================
    # Timer slots
    # ====================================================================

    def _on_update_tick(self) -> None:
        """Drain packet queue and refresh plots at 50 fps."""
        processed = 0
        while not self._pkt_queue.empty() and processed < 10:
            try:
                pkt = self._pkt_queue.get_nowait()
            except queue.Empty:
                break

            if pkt.type != TYPE_DATA:
                # Heartbeat — just used for connection detection.
                processed += 1
                continue

            frame = self._cop_calc.compute(pkt.raw, pkt.ts_us, pkt.seq)

            # Append to force buffers
            for i in range(4):
                self._force_buf[i].append(frame.f[i])

            # Append to COP trail (only when valid)
            if frame.cop_valid:
                self._cop_trail_x.append(frame.cop_x)
                self._cop_trail_y.append(frame.cop_y)

            # Session logging
            if self._recording:
                self._frames_session.append(frame)
                elapsed = time.monotonic() - self._session_start
                if elapsed >= self._spin_dur.value():
                    self._stop_recording()

            processed += 1

        # ---- Refresh plots ----
        # COP trail
        tx = np.array(self._cop_trail_x)
        ty = np.array(self._cop_trail_y)
        self._cop_trail_item.setData(tx, ty)
        if len(tx):
            self._cop_marker.setData([tx[-1]], [ty[-1]])

        # Force time series
        for i in range(4):
            buf = list(self._force_buf[i])
            self._force_curves[i].setData(buf)

        # Connection status indicator
        connected = getattr(self._source, 'connected', False)
        if connected:
            self._lbl_conn.setText('●  Connected')
            self._lbl_conn.setStyleSheet('color: #a6e3a1; font-weight: bold;')
        else:
            self._lbl_conn.setText('●  Disconnected')
            self._lbl_conn.setStyleSheet('color: #f38ba8; font-weight: bold;')

        rate = getattr(self._source, 'sample_rate', 0.0)
        self._lbl_rate.setText(f'Rate: {rate:.1f} Hz')
        drops = getattr(self._source, 'drop_count', 0)
        self._lbl_loss.setText(f'Packet loss: {drops}')

    def _on_metric_tick(self) -> None:
        """Refresh metric labels every 500 ms."""
        tx = np.array(self._cop_trail_x)
        ty = np.array(self._cop_trail_y)
        rate = getattr(self._source, 'sample_rate', 50.0) or 50.0
        m = MetricsCalculator.compute(tx, ty, rate)
        self._lbl_path.setText(f'Path: {m.path_mm:.1f} mm')
        self._lbl_vel.setText( f'Velocity: {m.mean_vel_mm_s:.1f} mm/s')
        self._lbl_area.setText(f'Ellipse: {m.ellipse_area:.0f} mm²')
        self._lbl_rms.setText( f'RMS x/y: {m.rms_x:.1f}/{m.rms_y:.1f} mm')

    def _on_ellipse_tick(self) -> None:
        """Recompute and redraw the 95% confidence ellipse every 1 s."""
        tx = np.array(self._cop_trail_x)
        ty = np.array(self._cop_trail_y)
        if len(tx) < 5:
            self._ellipse_item.setData([], [])
            return

        cov = np.cov(np.stack([tx, ty]))
        evals, evecs = np.linalg.eigh(cov)
        # Scale factor for 95% confidence ellipse (chi-squared df=2, p=0.95)
        scale = np.sqrt(5.991)
        semi_a = scale * np.sqrt(max(evals[1], 0.0))
        semi_b = scale * np.sqrt(max(evals[0], 0.0))
        angle  = np.arctan2(evecs[1, 1], evecs[0, 1])

        theta  = np.linspace(0, 2 * np.pi, 100)
        ex = semi_a * np.cos(theta)
        ey = semi_b * np.sin(theta)
        cos_a, sin_a = np.cos(angle), np.sin(angle)
        cx, cy = np.mean(tx), np.mean(ty)
        rx = ex * cos_a - ey * sin_a + cx
        ry = ex * sin_a + ey * cos_a + cy
        self._ellipse_item.setData(rx, ry)

    # ====================================================================
    # Session control
    # ====================================================================

    def _on_start_stop(self, checked: bool) -> None:
        if checked:
            self._start_recording()
            self._btn_start.setText('Stop Recording')
        else:
            self._stop_recording()
            self._btn_start.setText('Start Recording')

    def _start_recording(self) -> None:
        self._frames_session.clear()
        self._recording     = True
        self._session_start = time.monotonic()
        path = self._logger.start_session()
        self._last_csv_path = path
        self._btn_export.setEnabled(False)

    def _stop_recording(self) -> None:
        self._recording = False
        self._btn_start.setChecked(False)
        self._btn_start.setText('Start Recording')
        path = self._logger.end_session()
        if path:
            self._last_csv_path = path
            self._btn_export.setEnabled(True)

    def _on_export(self) -> None:
        if not hasattr(self, '_last_csv_path'):
            return
        QMessageBox.information(
            self,
            'CSV Saved',
            f'Session data saved to:\n{self._last_csv_path}',
        )

    # ====================================================================
    # Cleanup
    # ====================================================================

    def closeEvent(self, event) -> None:
        self._update_timer.stop()
        self._metric_timer.stop()
        self._ellipse_timer.stop()
        if hasattr(self._source, 'stop'):
            self._source.stop()
        super().closeEvent(event)
