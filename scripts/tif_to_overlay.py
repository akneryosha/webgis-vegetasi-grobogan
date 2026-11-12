"""
tif_to_overlay.py
=================
Konversi NDVI TIF → overlay PNG + bounds.json untuk WebGIS.
Tidak butuh rasterio — cukup PIL + numpy.

Instalasi:
    pip install pillow numpy

Cara pakai:
    1. Edit NDVI_INPUT_DIR dan WEBGIS_DIR di bawah
    2. python tif_to_overlay.py
"""

import os
import re
import json
import numpy as np
from PIL import Image

# =========================================================
# KONFIGURASI — sesuaikan path di sini
# =========================================================

NDVI_INPUT_DIR = r"C:\Skripsi_WebGIS_Grobogan\02_Data_Olahan\NDVI"
WEBGIS_DIR     = r"C:\Skripsi_WebGIS_Grobogan\03_Prototype_WebGIS\webgis"

# Opacity overlay di peta (0–255)
OVERLAY_OPACITY = 190

# Nilai nodata (piksel tidak valid)
NODATA_THRESHOLD = -1e10

# =========================================================
# SKEMA WARNA NDVI (selaras dengan legenda WebGIS)
# =========================================================
#   < 0.0        = biru      (badan air)
#   0.0 - 0.1   = tan/krem  (permukiman/non-vegetasi)
#   0.1 - 0.3   = kuning    (vegetasi rendah)
#   0.3 - 0.5   = hijau muda (vegetasi sedang)
#   > 0.5        = hijau tua  (vegetasi tinggi)
# =========================================================


def get_bounds(tif):
    """Ambil koordinat geografis dari tag GeoTIFF."""
    scale    = tif.tag_v2[33550]   # (pixel_width, pixel_height, 0)
    tiepoint = tif.tag_v2[33922]   # (i, j, k, x, y, z)

    px_w     = scale[0]
    px_h     = scale[1]
    origin_x = tiepoint[3]
    origin_y = tiepoint[4]

    w, h  = tif.size
    west  = origin_x
    north = origin_y
    east  = origin_x + px_w * w
    south = origin_y - px_h * h

    return south, west, north, east


def ndvi_to_rgba(arr):
    """Konversi array NDVI float32 ke RGBA."""
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    op   = OVERLAY_OPACITY

    valid = np.isfinite(arr) & (arr > NODATA_THRESHOLD)

    rgba[valid & (arr < 0.0)]                = [70,  130, 180, op]
    rgba[valid & (arr >= 0.0) & (arr < 0.1)] = [210, 180, 140, op]
    rgba[valid & (arr >= 0.1) & (arr < 0.3)] = [255, 255, 102, op]
    rgba[valid & (arr >= 0.3) & (arr < 0.5)] = [144, 238, 144, op]
    rgba[valid & (arr >= 0.5)]               = [26,  139,  26, op]

    return rgba


def find_tif(folder):
    """Cari file TIF di dalam folder."""
    for fname in sorted(os.listdir(folder)):
        lower = fname.lower()
        if (lower.endswith('.tif') or lower.endswith('.tiff')) and 'aux' not in lower:
            return os.path.join(folder, fname)
    return None


def process_date(date_str, tif_path, out_dir):
    """Proses satu TIF menjadi PNG + bounds.json."""
    tif = Image.open(tif_path)
    arr = np.array(tif, dtype='float32')

    south, west, north, east = get_bounds(tif)

    rgba = ndvi_to_rgba(arr)
    os.makedirs(out_dir, exist_ok=True)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(out_dir, 'ndvi_overlay.png'))

    bounds_data = {
        'south': south, 'west': west, 'north': north, 'east': east,
        'leaflet_bounds': [[south, west], [north, east]]
    }
    with open(os.path.join(out_dir, 'ndvi_bounds.json'), 'w') as f:
        json.dump(bounds_data, f, indent=2)

    valid = np.isfinite(arr) & (arr > NODATA_THRESHOLD)
    vals  = arr[valid]
    veg   = vals[vals > 0.1]
    mean_veg = round(float(np.mean(veg)), 4) if veg.size > 0 else None

    return mean_veg, vals.size, veg.size


def main():
    ndvi_dir = os.path.abspath(NDVI_INPUT_DIR)
    out_base = os.path.join(os.path.abspath(WEBGIS_DIR), 'output_ndvi')

    print("=" * 52)
    print("  TIF TO PNG OVERLAY CONVERTER")
    print("=" * 52)
    print(f"Input  : {ndvi_dir}")
    print(f"Output : {out_base}")

    if not os.path.isdir(ndvi_dir):
        print(f"\n[ERROR] Folder tidak ditemukan: {ndvi_dir}")
        print("Edit variabel NDVI_INPUT_DIR di bagian atas script.")
        return

    date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')
    dates = sorted([
        d for d in os.listdir(ndvi_dir)
        if date_pattern.match(d) and os.path.isdir(os.path.join(ndvi_dir, d))
    ])

    if not dates:
        print(f"\n[ERROR] Tidak ada subfolder tanggal di {ndvi_dir}")
        return

    print(f"\nDitemukan {len(dates)} tanggal: {', '.join(dates)}\n")

    success = 0
    for date_str in dates:
        tif_path = find_tif(os.path.join(ndvi_dir, date_str))
        out_dir  = os.path.join(out_base, date_str)

        if not tif_path:
            print(f"[SKIP] {date_str} — TIF tidak ditemukan")
            continue

        print(f"-> {date_str}: {os.path.basename(tif_path)}")
        try:
            mean_veg, n_total, n_veg = process_date(date_str, tif_path, out_dir)
            print(f"   OK ndvi_overlay.png")
            print(f"   OK ndvi_bounds.json")
            print(f"   NDVI mean vegetasi: {mean_veg}")
            success += 1
        except Exception as e:
            print(f"   [ERROR] {e}")

    print(f"\nSelesai: {success}/{len(dates)} berhasil")
    if success > 0:
        print(f"Output di: {out_base}")


if __name__ == '__main__':
    main()
