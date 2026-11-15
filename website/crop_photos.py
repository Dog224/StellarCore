"""Local photograph credits; no network request during recommendation scoring."""
import json
from functools import lru_cache
from pathlib import Path


def photo_catalogue():
    path = Path(__file__).parent / 'data' / 'crop_photos.json'
    return _read_catalogue(path.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _read_catalogue(modified):
    return json.loads((Path(__file__).parent / 'data' / 'crop_photos.json').read_text(encoding='utf-8'))


def photo_for(profile):
    photo = photo_catalogue().get(profile.slug)
    if photo and photo['path'] == profile.image_path:
        return {key: photo[key] for key in ('title', 'author', 'source_url', 'license', 'license_url', 'changes', 'framing')}
    return None
