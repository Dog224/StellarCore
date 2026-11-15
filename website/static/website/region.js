/* Same ray-crossing rules as website/region.py; GeoJSON coordinates are lon, lat. */
(() => {
  function ringPosition(x, y, ring) {
    let inside = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const cross = (x - a[0]) * dy - (y - a[1]) * dx;
      if (Math.abs(cross) <= 1e-10 * Math.max(1, Math.abs(dx), Math.abs(dy)) &&
          x >= Math.min(a[0], b[0]) - 1e-10 && x <= Math.max(a[0], b[0]) + 1e-10 &&
          y >= Math.min(a[1], b[1]) - 1e-10 && y <= Math.max(a[1], b[1]) + 1e-10) return 2;
      if ((a[1] > y) !== (b[1] > y) && x < dx * (y - a[1]) / dy + a[0]) inside = !inside;
    }
    return Number(inside);
  }
  function contains(region, latitude, longitude) {
    const x = Number(longitude), y = Number(latitude);
    if (latitude === null || longitude === null || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return region.features.some(feature => {
      const [west, south, east, north] = feature.bbox;
      if (x < west || x > east || y < south || y > north) return false;
      const geometry = feature.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      return polygons.some(rings => ringPosition(x, y, rings[0]) && !rings.slice(1).some(hole => ringPosition(x, y, hole) === 1));
    });
  }
  window.TerraGrowRegion = { contains };
})();
