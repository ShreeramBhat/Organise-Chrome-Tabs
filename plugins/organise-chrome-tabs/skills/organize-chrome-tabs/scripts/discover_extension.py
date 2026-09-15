#!/usr/bin/env python3
"""Read only Tab Steward registration metadata; never print full preferences."""
import argparse
import json
import os
from pathlib import Path
import sys


def discover(root):
    matches = {}
    for filename in ('Secure Preferences', 'Preferences'):
        for prefs in sorted(root.glob('*/' + filename)):
            try:
                settings = json.loads(prefs.read_text()).get('extensions', {}).get('settings', {})
            except (OSError, ValueError):
                continue
            for extension_id, entry in settings.items():
                manifest = entry.get('manifest', {})
                extension_path = Path(entry.get('path', ''))
                if not extension_path.is_absolute():
                    extension_path = prefs.parent / 'Extensions' / extension_path
                if not manifest.get('name'):
                    try:
                        manifest = json.loads((extension_path / 'manifest.json').read_text())
                    except (OSError, ValueError):
                        continue
                if manifest.get('name') != 'Tab Steward':
                    continue
                matches[(prefs.parent.name, extension_id)] = {
                    'profile': prefs.parent.name,
                    'extensionId': extension_id,
                    'version': manifest.get('version'),
                    'path': str(extension_path),
                    'dashboardUrl': 'chrome-extension://' + extension_id + '/dashboard.html',
                }
    return list(matches.values())


def main():
    if sys.platform == 'darwin':
        default = Path.home() / 'Library/Application Support/Google/Chrome'
    elif sys.platform == 'win32':
        default = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Google/Chrome/User Data'
    else:
        default = Path.home() / '.config/google-chrome'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user-data-dir', type=Path, default=default)
    args = parser.parse_args()
    matches = discover(args.user_data_dir)
    print(json.dumps({'candidates': matches}, indent=2))
    return 0 if matches else 1


if __name__ == '__main__':
    sys.exit(main())
