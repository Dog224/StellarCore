"""FAO GAEZ v5 catalogue and verified pin-based raster sampling."""
import hashlib
import json
import logging
import math
from functools import lru_cache
from urllib.error import HTTPError

from django.conf import settings
from django.utils import timezone
from .gaez_raster import sample_cell, cache

logger = logging.getLogger(__name__)
STORAGE = 'https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/'
DEFAULTS = {1: 'LR-LCC', 2: 'RES01-TMP', 3: 'RES02-YLD', 4: 'RES05-SIX30AS', 5: 'RES06-YLD', 6: 'RES07-YGA-CL'}


def catalogue():
    path = settings.BASE_DIR / 'website/data/gaez_catalog.json'
    return _load_catalogue(path, path.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _load_catalogue(path, modified):
    """Keep requests fast while allowing refreshed FAO metadata to take effect."""
    return json.loads(path.read_text(encoding='utf-8'))


def initial_selection(layer, field):
    result = {}
    crop = (getattr(field, 'next_crop', '') if field else '').strip().lower()
    for dimension in layer['dimensions']:
        code, choices = dimension['code'], dimension['options']
        if code.startswith('CROP'):
            result[code] = next((value for value, caption in choices.items() if caption.strip().lower() == crop), '')
        else:
            preferred = {'PERIOD': 'HP0120', 'CLIM': 'AGERA5', 'SSP': 'HIST', 'LCC': 'LC02',
                         'WTS': 'WSR', 'WSIM-RES02': 'LRLM', 'WSIM-RES05': 'LRLM'}.get(code)
            result[code] = preferred if preferred in choices else dimension.get('default') if dimension.get('default') in choices else next(iter(choices))
    return result


def get_point(field, layer_id, supplied):
    layer = next((value for value in catalogue()['layers'] if value['id'] == layer_id), None)
    if not layer: raise ValueError('Unknown GAEZ layer')
    selections = initial_selection(layer, field)
    expected = {dimension['code'] for dimension in layer['dimensions']}
    if set(supplied) - expected: raise ValueError('Unexpected GAEZ dimension')
    selections.update(supplied)
    for dimension in layer['dimensions']:
        value = selections[dimension['code']]
        if value and value not in dimension['options']: raise ValueError('Invalid GAEZ dimension value')
    labels = {dimension['label']: dimension['options'].get(selections[dimension['code']], 'Not selected') for dimension in layer['dimensions']}
    base = {'layer': layer_id, 'theme': layer['theme'], 'title': layer['title'], 'unit': layer['unit'],
            'version': 'GAEZ v5', 'selections': selections, 'selection_labels': labels,
            'source_url': layer['source_url'], 'publication': layer['publication'],
            'credit': layer['credit'], 'license': layer['license'],
            'period_note': 'Circa 2020 (downscaled 2019–2021 statistics)' if layer['theme'] in (5, 6) else
                           ('Circa 2020 land cover' if layer_id == 'LR-LCC' else 'Static land-resource layer; see FAO metadata') if layer['theme'] == 1 else labels.get('Period', ''),
            'limitation': 'Long-term grid-cell information, not a measurement of this exact field or a prediction of your harvest.'}
    if not field or field.latitude is None or field.longitude is None:
        return {**base, 'status': 'needs_location', 'message': 'Save your field pin to load GAEZ data.'}
    if any(not value for value in selections.values()):
        return {**base, 'status': 'selection_required', 'message': 'Choose an available crop for this layer. No substitute crop was selected.'}
    if 'PERIOD' in selections and 'CLIM' in selections and 'SSP' in selections:
        historic = selections['PERIOD'].startswith('HP')
        if historic != (selections['CLIM'] == 'AGERA5') or historic != (selections['SSP'] == 'HIST'):
            return {**base, 'status': 'selection_required', 'message': 'Historical periods require AgERA5 / HIST; future periods require a climate model and SSP.'}
    if layer['dimensions']:
        suffix = '.'.join(selections[dimension['code']] for dimension in layer['dimensions'])
        filename = f'GAEZ-V5.{layer_id}.{suffix}.tif'
        url = STORAGE + f'MAPSET/{layer_id}/' + filename
    else:
        filename = f'GAEZ-V5.{layer_id}.tif'
        url = STORAGE + 'MAP/' + filename
    latitude, longitude = float(field.latitude), float(field.longitude)
    base.update(raster_url=url, filename=filename, latitude=latitude, longitude=longitude)
    key = 'point-v2-' + hashlib.sha256(f'{url}:{latitude:.7f}:{longitude:.7f}'.encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None: return {**base, **cached}
    try:
        sampled = sample_cell(url, latitude, longitude)
        raw = sampled.get('raw_value')
        result = {key: sampled[key] for key in ('status', 'raw_value', 'cell_center', 'resolution_degrees') if key in sampled}
        result['retrieved_at'] = timezone.now().isoformat()
        if sampled['status'] == 'ok' and layer['nodata'] is not None and raw == layer['nodata']:
            result['status'] = 'no_data'
        if result['status'] == 'ok':
            # Apply the documented FAO scale once, not both TIFF and catalogue scales.
            value = raw * layer['scale'] + sampled.get('offset', 0)
            if not math.isfinite(value): raise ValueError('Invalid scaled raster value')
            result.update(value=value, scale_factor=layer['scale'])
            result['class_label'] = layer.get('classes', {}).get(format(value, 'g'))
        elif result['status'] == 'no_data':
            result['message'] = 'FAO marks this cell as no data. It does not mean the crop is unsuitable.'
        else:
            result['message'] = 'The selected layer does not cover this pin.'
        cache.set(key, result, 86400)
        return {**base, **result}
    except HTTPError as error:
        message = 'This combination is not published in the FAO repository.' if error.code == 404 else 'FAO data is temporarily unavailable. Try again later.'
    except (OSError, ValueError, KeyError, IndexError, TypeError, RuntimeError):
        logger.warning('GAEZ point read unavailable for %s', layer_id)
        message = 'FAO data could not be read within the request limit. Try again later.'
    result = {'status': 'unavailable', 'message': message}
    cache.set(key, result, 120)
    return {**base, **result}
