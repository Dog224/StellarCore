# Live Laos crop-location validation

2026-11-14T12:46:21.684203+00:00

Actual FAO GAEZ, NASA POWER and SRTM responses; no environment fixtures; no database writes.

| Location | Annual mean °C | Annual rain mm | Elevation m | Top three estimated matches |
|---|---:|---:|---:|---|
| Vientiane lowlands | 26.1 | 1762.7 | 173.0 | Arabica coffee (100.0/100), Banana (100.0/100), Rice (100.0/100) |
| Paksong, Bolaven Plateau | 20.05 | 3496.6 | 1285.0 | Banana (87.4/100), Robusta coffee (79.6/100), Cassava (76.5/100) |
| Phongsaly highlands | 20.26 | 1925.8 | 1360.0 | Arabica coffee (100.0/100), Rice (100.0/100), Cassava (95.0/100) |

All three use FAO GAEZ / AgERA5 2001–2020 annual climate. Terrain is SRTM v3 (~90 m, February 2000). NASA monthly climate is a separately dated planning input; it is not mixed into the annual score.

Soil pH and texture are unknown at all three test points and are excluded from the score. Scores are partial environmental matches, not verified local advice or harvest probabilities. See the JSON for full per-factor requirements, source URLs, retrieval dates, missing data, and all 13 ranked crops.
