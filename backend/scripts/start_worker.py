"""Use the same explicit runtime config as Backend; delegate unchanged Worker rules."""
import argparse
import sys
from pathlib import Path
from scripts.start_backend import BACKEND, configure, preflight


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, default=BACKEND / '.env.runtime')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--status', action='store_true')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    values = configure(args.env_file)
    paths = preflight(values)
    for key in ('BE04_FARM_ID', 'BE04_OWNER_USER_ID'):
        if not values.get(key): parser.error(f'Configure {key} explicitly')
    if args.apply and not values.get('SUPABASE_KEY'): parser.error('SUPABASE_KEY required for synchronization')
    if args.watch and not args.apply: parser.error('--watch requires --apply')
    sys.argv = ['be04_worker', '--db', paths['database'], '--media-dir', paths['media'],
                '--farm-id', values['BE04_FARM_ID'], '--owner-user-id', values['BE04_OWNER_USER_ID'],
                '--active-db-check', '--apply' if args.apply else '--status']
    if args.watch: sys.argv.append('--watch')
    from scripts.be04_worker import main as run
    run()


if __name__ == '__main__':
    main()
