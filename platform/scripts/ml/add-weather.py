#!/usr/bin/env python3
"""
Fetch real season weather per county-year (Open-Meteo ERA5 archive) and
write weather.json keyed by "fips-year". Covariates chosen for their known
agronomic mechanism, not fished from the data:
  - precip_jja_mm: June-Aug precipitation total (water supply)
  - tmax_mean_jja: mean daily max temp June-Aug (heat load)
  - days_gt32_jja: days above 32°C June-Aug (pollination heat stress)
Usage: python3 add-weather.py features.jsonl weather.json
"""
import json
import sys
import time
import urllib.request

feat_path, out_path = sys.argv[1], sys.argv[2]

# county centroid = mean of patch coords in the features file (real sampled locations)
coords = {}
for line in open(feat_path):
    if not line.strip():
        continue
    r = json.loads(line)
    key = f"{r['fips']}-{r['year']}"
    coords.setdefault(key, []).append((r["patchLat"], r["patchLng"]))

out = {}
for i, (key, pts) in enumerate(sorted(coords.items())):
    fips, year = key.split("-")
    lat = sum(p[0] for p in pts) / len(pts)
    lng = sum(p[1] for p in pts) / len(pts)
    url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={lat:.4f}&longitude={lng:.4f}"
           f"&start_date={year}-06-01&end_date={year}-08-31"
           f"&daily=precipitation_sum,temperature_2m_max&timezone=UTC")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                d = json.load(resp)
            daily = d["daily"]
            precip = [v for v in daily["precipitation_sum"] if v is not None]
            tmax = [v for v in daily["temperature_2m_max"] if v is not None]
            out[key] = {
                "precip_jja_mm": round(sum(precip), 1),
                "tmax_mean_jja": round(sum(tmax) / len(tmax), 2),
                "days_gt32_jja": sum(1 for v in tmax if v > 32),
            }
            break
        except Exception as e:
            if attempt == 3:
                print(f"{key}: FAILED {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    if (i + 1) % 20 == 0:
        print(f"{i+1}/{len(coords)}")
    time.sleep(0.3)  # be polite to the free API

json.dump(out, open(out_path, "w"), indent=1)
print(f"{len(out)} county-year weather records → {out_path}")
