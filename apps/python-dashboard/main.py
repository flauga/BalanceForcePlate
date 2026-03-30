"""
main.py — Entry point for the Force Plate dashboard.

Usage
-----
    # Real hardware (ESP32 on ForcePlate_01 AP):
    python main.py

    # Synthetic data (no hardware required):
    python main.py --simulate

    # Override config file:
    python main.py --config /path/to/myconfig.ini

    # Override UDP port:
    python main.py --port 12346

    # Override body weight (used for COP guard threshold):
    python main.py --weight 65.0

Dependencies (see requirements.txt):
    pip install PyQt6 pyqtgraph numpy scipy
"""

import argparse
import configparser
import sys
from pathlib import Path

from PyQt6.QtWidgets import QApplication

from dashboard import ForcePlateDashboard


def _load_config(path: str) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    defaults = {
        'plate': {
            'half_width_mm':  '200',
            'half_height_mm': '200',
            'body_weight_kg': '70.0',
        },
        'network': {
            'udp_bind_ip': '0.0.0.0',
            'udp_port':    '12345',
        },
        'session': {
            'default_duration_s':  '30',
            'cop_guard_fraction':  '0.05',
        },
        'logging': {
            'output_dir': '~/force-plate-sessions',
        },
    }
    for section, values in defaults.items():
        cfg[section] = values

    if Path(path).exists():
        cfg.read(path)
    else:
        print(f'[main] Config file not found: {path!r} — using defaults.')

    return cfg


def main() -> None:
    parser = argparse.ArgumentParser(
        description='ESP32 Force Plate real-time dashboard',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--config', default='config.ini',
        help='Path to INI config file (default: config.ini)',
    )
    parser.add_argument(
        '--simulate', action='store_true',
        help='Run in simulation mode (no hardware required)',
    )
    parser.add_argument(
        '--port', type=int, default=None,
        help='Override UDP receive port (default from config: 12345)',
    )
    parser.add_argument(
        '--weight', type=float, default=None,
        help="Override subject body weight in kg (default from config: 70.0)",
    )
    args = parser.parse_args()

    cfg = _load_config(args.config)

    if args.port is not None:
        cfg['network']['udp_port'] = str(args.port)
    if args.weight is not None:
        cfg['plate']['body_weight_kg'] = str(args.weight)

    app = QApplication(sys.argv)
    app.setStyle('Fusion')

    # Dark palette
    palette = app.palette()
    palette.setColor(palette.ColorRole.Window,          QColor('#1e1e2e'))
    palette.setColor(palette.ColorRole.WindowText,      QColor('#cdd6f4'))
    palette.setColor(palette.ColorRole.Base,            QColor('#181825'))
    palette.setColor(palette.ColorRole.AlternateBase,   QColor('#1e1e2e'))
    palette.setColor(palette.ColorRole.Button,          QColor('#313244'))
    palette.setColor(palette.ColorRole.ButtonText,      QColor('#cdd6f4'))
    palette.setColor(palette.ColorRole.Highlight,       QColor('#89b4fa'))
    palette.setColor(palette.ColorRole.HighlightedText, QColor('#1e1e2e'))
    app.setPalette(palette)

    window = ForcePlateDashboard(cfg, simulate=args.simulate)
    window.setWindowTitle('Force Plate Dashboard — ESP32 Phase 1')
    window.resize(1400, 900)
    window.show()
    sys.exit(app.exec())


if __name__ == '__main__':
    from PyQt6.QtGui import QColor
    main()
