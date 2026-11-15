"""Load private, server-side configuration from this project's local file."""
from pathlib import Path

from dotenv import load_dotenv


def load_local_environment(base_dir):
    # Never search parent folders or replace deployment environment variables.
    # Treat secret values literally; they must not expand other variables.
    load_dotenv(Path(base_dir) / '.env', override=False, interpolate=False,
                encoding='utf-8-sig')
