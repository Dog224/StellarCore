"""Shared, local country coverage for the map and location-save validation."""
import json
import math
from functools import lru_cache
from pathlib import Path

REGION_MESSAGE = 'Choose a location in Laos, Thailand, Myanmar, Cambodia or Vietnam.'


@lru_cache(maxsize=1)
def map_region():
    return json.loads((Path(__file__).parent / 'data' / 'mekong_region.geojson').read_text(encoding='utf-8'))


def _ring_position(x, y, ring):
    """0 outside, 1 inside, 2 on the boundary; coordinates are lon, lat."""
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        cross = (x - a[0]) * dy - (y - a[1]) * dx
        if (abs(cross) <= 1e-10 * max(1, abs(dx), abs(dy))
                and min(a[0], b[0]) - 1e-10 <= x <= max(a[0], b[0]) + 1e-10
                and min(a[1], b[1]) - 1e-10 <= y <= max(a[1], b[1]) + 1e-10):
            return 2
        if (a[1] > y) != (b[1] > y) and x < dx * (y - a[1]) / dy + a[0]:
            inside = not inside
    return int(inside)


def contains_location(latitude, longitude, region=None):
    try:
        x, y = float(longitude), float(latitude)
    except (ValueError, TypeError, OverflowError):
        return False
    if not math.isfinite(x) or not math.isfinite(y):
        return False
    for feature in (map_region() if region is None else region)['features']:
        west, south, east, north = feature['bbox']
        if not (west <= x <= east and south <= y <= north):
            continue
        geometry = feature['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for rings in polygons:
            if _ring_position(x, y, rings[0]) and not any(_ring_position(x, y, hole) == 1 for hole in rings[1:]):
                return True
    return False
