"""Read one geographic GeoTIFF cell using bounded, cached HTTP range reads."""
import hashlib
import io
import math
import re
import time
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.cache.backends.filebased import FileBasedCache
import tifffile
import numpy as np

BLOCK_SIZE = 65536
cache = FileBasedCache(str(settings.BASE_DIR / '.gaez_cache'), {'TIMEOUT': 86400, 'OPTIONS': {'MAX_ENTRIES': 1500}})


def decode_lzw(encoded, max_output):
    """TIFF 6.0 MSB-first LZW with early code-width changes; bounded tile output."""
    table = [bytes([i]) for i in range(256)] + [b'', b'']
    width, previous, accumulator, bits, position = 9, b'', 0, 0, 0
    output = bytearray()
    while True:
        while bits < width:
            if position >= len(encoded): raise ValueError('Truncated LZW tile')
            accumulator = (accumulator << 8) | encoded[position]
            bits += 8
            position += 1
        bits -= width
        code = (accumulator >> bits) & ((1 << width) - 1)
        accumulator &= (1 << bits) - 1
        if code == 257: return bytes(output)
        if code == 256:
            table = table[:258]
            width, previous = 9, b''
            continue
        if code < len(table): entry = table[code]
        elif code == len(table) and previous: entry = previous + previous[:1]
        else: raise ValueError('Invalid LZW code')
        if len(output) + len(entry) > max_output: raise ValueError('Oversized LZW tile')
        output.extend(entry)
        if previous and len(table) < 4096:
            table.append(previous + entry[:1])
            if len(table) == (1 << width) - 1 and width < 12: width += 1
        previous = entry


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.position = 0
        self.deadline = time.monotonic() + 25
        self.downloaded = 0
        self.name = url.rsplit('/', 1)[-1]
        self.key = hashlib.sha256(url.encode()).hexdigest()
        self.size = cache.get('size-' + self.key)
        if self.size is None:
            with urlopen(Request(url, method='HEAD', headers={'Accept-Encoding': 'identity'}), timeout=8) as response:
                self.size = int(response.headers['Content-Length'])
            cache.set('size-' + self.key, self.size)

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.position

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if position < 0: raise ValueError('Negative seek')
        self.position = position
        return self.position

    def read(self, size=-1):
        if size < 0: size = self.size - self.position
        size = min(size, self.size - self.position)
        if size <= 0: return b''
        if size > 4 * 1024 * 1024: raise ValueError('Oversized raster read refused')
        output = []
        end = self.position + size
        while self.position < end:
            block = self.position // BLOCK_SIZE
            key = f'block-{self.key}-{block}'
            data = cache.get(key)
            if data is None:
                remaining = self.deadline - time.monotonic()
                if remaining <= 0 or self.downloaded >= 8 * 1024 * 1024:
                    raise TimeoutError('Raster request budget exceeded')
                # Fetch a contiguous tile/metadata read in one request, rather than
                # paying network latency separately for every 64 KiB cache block.
                first = block * BLOCK_SIZE
                last = min(math.ceil(end / BLOCK_SIZE) * BLOCK_SIZE - 1,
                           first + 1024 * 1024 - 1, self.size - 1)
                request = Request(self.url, headers={'Range': f'bytes={first}-{last}', 'Accept-Encoding': 'identity'})
                with urlopen(request, timeout=min(8, remaining)) as response:
                    if response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {first}-{last}/'):
                        raise ValueError('Remote server did not honor byte range')
                    batch = response.read(last - first + 2)
                if len(batch) != last - first + 1: raise ValueError('Truncated raster block')
                self.downloaded += len(batch)
                for offset in range(0, len(batch), BLOCK_SIZE):
                    cache.set(f'block-{self.key}-{block + offset // BLOCK_SIZE}', batch[offset:offset + BLOCK_SIZE])
                data = batch[:BLOCK_SIZE]
            offset = self.position % BLOCK_SIZE
            count = min(len(data) - offset, end - self.position)
            if count <= 0: raise ValueError('Invalid raster block')
            output.append(data[offset:offset + count])
            self.position += count
        return b''.join(output)


def sample_cell(url, latitude, longitude):
    with RangeFile(url) as remote, tifffile.TiffFile(remote) as image:
        page = image.pages[0]
        if page.samplesperpixel != 1: raise ValueError('Expected single-band raster')
        geo = page.geotiff_tags or {}
        if int(geo.get('GeographicTypeGeoKey', 0)) != 4326 or geo.get('ProjectedCSTypeGeoKey'):
            raise ValueError('Only geographic WGS84 rasters are supported')
        scale = page.tags['ModelPixelScaleTag'].value
        tie = page.tags['ModelTiepointTag'].value
        if scale[0] <= 0 or scale[1] <= 0: raise ValueError('Unsupported pixel transform')
        # GeoTIFF can encode a tie point away from image pixel (0,0).
        left, top = tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]
        if int(geo.get('GTRasterTypeGeoKey', 1)) == 2:
            left -= scale[0] / 2
            top += scale[1] / 2
        col = math.floor((longitude - left) / scale[0])
        row = math.floor((top - latitude) / scale[1])
        if not (0 <= col < page.imagewidth and 0 <= row < page.imagelength):
            return {'status': 'outside_coverage'}
        if page.is_tiled:
            width, height = page.tilewidth, page.tilelength
            index = (row // height) * math.ceil(page.imagewidth / width) + col // width
            cellrow, cellcol = row % height, col % width
        else:
            width, height = page.imagewidth, page.rowsperstrip
            index = row // height
            cellrow, cellcol = row % height, col
        remote.seek(page.dataoffsets[index])
        encoded = remote.read(page.databytecounts[index])
        if int(page.compression) == 5 and int(page.predictor) in (1, 2):
            dtype = page.dtype.newbyteorder(image.byteorder)
            segment_height = height if page.is_tiled else min(height, page.imagelength - index * height)
            decoded = decode_lzw(encoded, segment_height * width * dtype.itemsize)
            data = np.frombuffer(decoded, dtype=dtype).reshape(1, segment_height, width, 1)
            if int(page.predictor) == 2:
                if dtype.kind not in 'ui': raise ValueError('Unsupported floating-point predictor')
                data = np.cumsum(data, axis=2, dtype=dtype)
        else:
            data, _, _ = page.decode(encoded, index)
        value = float(data[0, cellrow, cellcol, 0])
        nodata = page.tags.get('GDAL_NODATA')
        nodata_value = float(str(nodata.value).strip('\x00')) if nodata else None
        tags = page.tags.get('GDAL_METADATA')
        metadata = tags.value if tags else ''
        scale_match = re.search(r'<Item[^>]*name="(?:SCALE|scale_factor)"[^>]*>([^<]+)', metadata)
        offset_match = re.search(r'<Item[^>]*name="(?:OFFSET|add_offset)"[^>]*>([^<]+)', metadata)
        factor = float(scale_match[1]) if scale_match else 1
        offset = float(offset_match[1]) if offset_match else 0
        base = {'raw_value': value if math.isfinite(value) else None, 'nodata': nodata_value,
                'resolution_degrees': [scale[0], scale[1]], 'scale_factor': factor, 'offset': offset,
                'cell_center': [top - (row + .5) * scale[1], left + (col + .5) * scale[0]],
                'metadata': metadata, 'downloaded_bytes': remote.downloaded}
        if not math.isfinite(value) or (nodata_value is not None and value == nodata_value):
            return {**base, 'status': 'no_data', 'value': None}
        return {**base, 'status': 'ok', 'value': value * factor + offset}
