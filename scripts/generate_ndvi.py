import os
import json
import numpy as np
import rasterio
from rasterio.mask import mask
from PIL import Image

# =========================================================
# KONFIGURASI FILE
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

B04_PATH = os.path.join(
    BASE_DIR,
    "2025-08-15-00_00_2025-08-15-23_59_Sentinel-2_L2A_B04_(Raw).tiff"
)

B08_PATH = os.path.join(
    BASE_DIR,
    "2025-08-15-00_00_2025-08-15-23_59_Sentinel-2_L2A_B08_(Raw).tiff"
)

GROBOGAN_GEOJSON = os.path.join(BASE_DIR, "grobogan.geojson")

OUT_DIR = os.path.join(BASE_DIR, "output_ndvi")
os.makedirs(OUT_DIR, exist_ok=True)

NDVI_RAW_TIF = os.path.join(OUT_DIR, "ndvi_raw.tif")
NDVI_CLIP_TIF = os.path.join(OUT_DIR, "ndvi_grobogan.tif")
NDVI_PNG = os.path.join(OUT_DIR, "ndvi_overlay.png")
NDVI_BOUNDS_JSON = os.path.join(OUT_DIR, "ndvi_bounds.json")
NDVI_STATS_JSON = os.path.join(OUT_DIR, "ndvi_stats.json")

NODATA_VALUE = -9999.0

# =========================================================
# THRESHOLD MASKING PERMUKIMAN
# Piksel dengan NDVI <= ambang ini dianggap non-vegetasi
# (permukiman, jalan, badan air) dan diabaikan dari
# perhitungan rata-rata NDVI per kecamatan.
# Referensi: Brillyansyah et al. (2024), Utomo et al. (2022)
# =========================================================
NDVI_VEGETATION_THRESHOLD = 0.1


# =========================================================
# FUNGSI BANTU
# =========================================================
def load_geojson_geometries(geojson_path):
    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    geo_type = data.get("type")

    if geo_type == "FeatureCollection":
        geoms = [feat["geometry"] for feat in data["features"] if feat.get("geometry")]
    elif geo_type == "Feature":
        geoms = [data["geometry"]]
    elif geo_type in ["Polygon", "MultiPolygon"]:
        geoms = [data]
    else:
        raise ValueError("Format GeoJSON tidak valid")

    if not geoms:
        raise ValueError("GeoJSON tidak punya geometry")

    return geoms


def check_alignment():
    with rasterio.open(B04_PATH) as red_src, rasterio.open(B08_PATH) as nir_src:
        errors = []

        if red_src.width != nir_src.width or red_src.height != nir_src.height:
            errors.append(
                f"Ukuran raster beda: B04={red_src.width}x{red_src.height}, "
                f"B08={nir_src.width}x{nir_src.height}"
            )

        if red_src.crs != nir_src.crs:
            errors.append(f"CRS beda: B04={red_src.crs}, B08={nir_src.crs}")

        if red_src.transform != nir_src.transform:
            errors.append("Grid/transform raster beda")

        if errors:
            raise ValueError("Input raster tidak align:\n- " + "\n- ".join(errors))

        print("[OK] B04 dan B08 align")
        print(f"[INFO] CRS    : {red_src.crs}")
        print(f"[INFO] Ukuran : {red_src.width} x {red_src.height}")
        print(f"[INFO] Bounds : {red_src.bounds}")


def compute_ndvi():
    with rasterio.open(B04_PATH) as red_src, rasterio.open(B08_PATH) as nir_src:
        red = red_src.read(1).astype("float32")
        nir = nir_src.read(1).astype("float32")

        # Mask valid dasar
        valid_mask = np.isfinite(red) & np.isfinite(nir)

        if red_src.nodata is not None:
            valid_mask &= (red != red_src.nodata)

        if nir_src.nodata is not None:
            valid_mask &= (nir != nir_src.nodata)

        # Area background hitam dari hasil crop biasanya 0
        # Ini juga kita anggap tidak valid kalau red dan nir sama-sama 0
        valid_mask &= ~((red == 0) & (nir == 0))

        denominator = nir + red

        ndvi = np.full(red.shape, np.nan, dtype="float32")
        safe_mask = valid_mask & np.isfinite(denominator) & (denominator != 0)

        ndvi[safe_mask] = (nir[safe_mask] - red[safe_mask]) / denominator[safe_mask]
        ndvi = np.clip(ndvi, -1.0, 1.0)

        ndvi_out = np.where(np.isfinite(ndvi), ndvi, NODATA_VALUE).astype("float32")

        profile = red_src.profile.copy()
        profile.update(
            driver="GTiff",
            dtype="float32",
            count=1,
            nodata=NODATA_VALUE,
            compress="lzw"
        )

        with rasterio.open(NDVI_RAW_TIF, "w", **profile) as dst:
            dst.write(ndvi_out, 1)

    print(f"[OK] NDVI raw tersimpan: {NDVI_RAW_TIF}")


def clip_ndvi_to_grobogan():
    geometries = load_geojson_geometries(GROBOGAN_GEOJSON)

    with rasterio.open(NDVI_RAW_TIF) as src:
        clipped_image, clipped_transform = mask(
            src,
            geometries,
            crop=True,
            nodata=NODATA_VALUE,
            filled=True
        )

        out_meta = src.meta.copy()
        out_meta.update({
            "height": clipped_image.shape[1],
            "width": clipped_image.shape[2],
            "transform": clipped_transform,
            "nodata": NODATA_VALUE,
            "compress": "lzw"
        })

        with rasterio.open(NDVI_CLIP_TIF, "w", **out_meta) as dst:
            dst.write(clipped_image)

    print(f"[OK] NDVI clip tersimpan: {NDVI_CLIP_TIF}")


def ndvi_to_rgba(ndvi_array, nodata_value):
    """
    Ubah NDVI ke warna RGBA untuk overlay PNG di WebGIS.
    Area nodata dibuat transparan.

    Skema warna diselaraskan dengan legenda WebGIS dan threshold masking:
    - NDVI < 0.0   : badan air / tidak valid       → biru
    - 0.0 – 0.1   : non-vegetasi / permukiman      → tan/krem
    - 0.1 – 0.3   : vegetasi rendah (lahan kering) → kuning
    - 0.3 – 0.5   : vegetasi sedang                → hijau muda
    - > 0.5        : vegetasi tinggi / sehat        → hijau tua

    Referensi: Brillyansyah et al. (2024), Utomo et al. (2022)
    """
    h, w = ndvi_array.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    valid = np.isfinite(ndvi_array) & (ndvi_array != nodata_value)

    # default transparan
    rgba[..., 3] = 0

    # < 0.0 = badan air / tidak valid
    mask1 = valid & (ndvi_array < 0.0)
    rgba[mask1] = [70, 130, 180, 190]   # steel blue

    # 0.0 – 0.1 = non-vegetasi / permukiman / lahan terbangun
    mask2 = valid & (ndvi_array >= 0.0) & (ndvi_array < 0.1)
    rgba[mask2] = [210, 180, 140, 190]  # tan/krem

    # 0.1 – 0.3 = vegetasi rendah / lahan kering
    mask3 = valid & (ndvi_array >= 0.1) & (ndvi_array < 0.3)
    rgba[mask3] = [255, 255, 102, 190]  # kuning

    # 0.3 – 0.5 = vegetasi sedang
    mask4 = valid & (ndvi_array >= 0.3) & (ndvi_array < 0.5)
    rgba[mask4] = [144, 238, 144, 190]  # hijau muda

    # > 0.5 = vegetasi tinggi / sehat
    mask5 = valid & (ndvi_array >= 0.5)
    rgba[mask5] = [26, 139, 26, 190]    # hijau tua

    return rgba


def export_png_and_bounds():
    with rasterio.open(NDVI_CLIP_TIF) as src:
        ndvi = src.read(1).astype("float32")
        rgba = ndvi_to_rgba(ndvi, src.nodata)

        img = Image.fromarray(rgba, mode="RGBA")
        img.save(NDVI_PNG)

        bounds = src.bounds
        payload = {
            "south": bounds.bottom,
            "west": bounds.left,
            "north": bounds.top,
            "east": bounds.right,
            "leaflet_bounds": [
                [bounds.bottom, bounds.left],
                [bounds.top, bounds.right]
            ]
        }

        with open(NDVI_BOUNDS_JSON, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    print(f"[OK] PNG overlay tersimpan : {NDVI_PNG}")
    print(f"[OK] Bounds JSON tersimpan : {NDVI_BOUNDS_JSON}")


def save_stats():
    with rasterio.open(NDVI_CLIP_TIF) as src:
        arr = src.read(1).astype("float32")
        nodata = src.nodata

        valid = np.isfinite(arr)
        if nodata is not None:
            valid &= (arr != nodata)

        values = arr[valid]

        # Filter vegetasi: exclude permukiman, jalan, badan air
        # menggunakan threshold NDVI_VEGETATION_THRESHOLD
        values_veg = values[values > NDVI_VEGETATION_THRESHOLD]

        if values.size == 0:
            stats = {"message": "Tidak ada piksel valid"}
        else:
            stats = {
                "min": float(np.min(values)),
                "max": float(np.max(values)),
                "mean_all": float(np.mean(values)),
                "mean_vegetasi": float(np.mean(values_veg)) if values_veg.size > 0 else None,
                "median": float(np.median(values)),
                "std": float(np.std(values)),
                "valid_pixel_count": int(values.size),
                "vegetation_pixel_count": int(values_veg.size),
                "ndvi_threshold_used": NDVI_VEGETATION_THRESHOLD,
                "catatan": (
                    f"mean_vegetasi dihitung hanya dari piksel NDVI > {NDVI_VEGETATION_THRESHOLD} "
                    f"(exclude permukiman/non-vegetasi)"
                )
            }

        with open(NDVI_STATS_JSON, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)

    print(f"[OK] Statistik tersimpan: {NDVI_STATS_JSON}")


def compute_ndvi_per_kecamatan(kecamatan_geojson_path: str, output_json_path: str):
    """
    Hitung rata-rata NDVI per kecamatan dari NDVI TIF yang sudah di-clip,
    dengan threshold masking untuk mengecualikan piksel non-vegetasi
    (permukiman, jalan, badan air).

    Pendekatan threshold-based masking sebagai alternatif land-cover
    classification (Utomo et al., 2022; Brillyansyah et al., 2024).

    Args:
        kecamatan_geojson_path: path GeoJSON batas kecamatan
        output_json_path: path output JSON metrics
    """
    if not os.path.exists(NDVI_CLIP_TIF):
        raise FileNotFoundError(
            f"NDVI clip TIF tidak ditemukan: {NDVI_CLIP_TIF}\n"
            "Jalankan dulu: compute_ndvi() dan clip_ndvi_to_grobogan()"
        )

    with open(kecamatan_geojson_path, "r", encoding="utf-8") as f:
        geojson_data = json.load(f)

    features = geojson_data.get("features", [])
    if not features:
        raise ValueError("GeoJSON kecamatan tidak memiliki features.")

    results = []

    with rasterio.open(NDVI_CLIP_TIF) as src:
        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry")

            if geom is None:
                continue

            # Ambil ID dan nama kecamatan
            kec_id = (
                props.get("id")
                or props.get("kode")
                or props.get("kode_kecamatan")
                or props.get("KODE")
                or ""
            )
            kec_name = (
                props.get("kecamatan")
                or props.get("KECAMATAN")
                or props.get("nama")
                or props.get("NAMA")
                or props.get("wadmkc")
                or str(kec_id)
            )

            try:
                from rasterio.mask import mask as rasterio_mask
                clipped, _ = rasterio_mask(
                    src,
                    [geom],
                    crop=True,
                    nodata=NODATA_VALUE,
                    filled=True,
                    all_touched=False,
                )
                arr = clipped[0].astype("float32")

                # Mask valid: bukan nodata, bukan NaN
                valid = np.isfinite(arr) & (arr != NODATA_VALUE)
                values = arr[valid]

                # Threshold masking: exclude non-vegetasi (permukiman dst.)
                values_veg = values[values > NDVI_VEGETATION_THRESHOLD]

                if values_veg.size > 0:
                    ndvi_mean = round(float(np.mean(values_veg)), 4)
                elif values.size > 0:
                    # Fallback: pakai semua piksel jika tidak ada yang lolos threshold
                    ndvi_mean = round(float(np.mean(values)), 4)
                    print(f"  [WARN] {kec_name}: tidak ada piksel vegetasi, "
                          f"fallback ke semua piksel ({values.size} piksel)")
                else:
                    ndvi_mean = 0.0
                    print(f"  [WARN] {kec_name}: tidak ada piksel valid sama sekali")

            except Exception as e:
                ndvi_mean = 0.0
                print(f"  [WARN] {kec_name}: gagal extract NDVI — {e}")

            results.append({
                "id": str(kec_id),
                "kecamatan": str(kec_name),
                "ndvi_mean": ndvi_mean,
            })

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"[OK] NDVI per kecamatan tersimpan: {output_json_path}")
    print(f"     Total kecamatan: {len(results)}")
    print(f"     Threshold masking: NDVI > {NDVI_VEGETATION_THRESHOLD} "
          f"(exclude permukiman/non-vegetasi)")


def main():
    print("=== PROSES NDVI DIMULAI ===")

    if not os.path.exists(B04_PATH):
        raise FileNotFoundError(f"File B04 tidak ditemukan:\n{B04_PATH}")

    if not os.path.exists(B08_PATH):
        raise FileNotFoundError(f"File B08 tidak ditemukan:\n{B08_PATH}")

    if not os.path.exists(GROBOGAN_GEOJSON):
        raise FileNotFoundError(f"File grobogan.geojson tidak ditemukan:\n{GROBOGAN_GEOJSON}")

    check_alignment()
    compute_ndvi()
    clip_ndvi_to_grobogan()
    export_png_and_bounds()
    save_stats()

    print("\n=== SELESAI ===")
    print(f"1. NDVI raw tif          : {NDVI_RAW_TIF}")
    print(f"2. NDVI clip tif         : {NDVI_CLIP_TIF}")
    print(f"3. PNG overlay           : {NDVI_PNG}")
    print(f"4. Bounds JSON           : {NDVI_BOUNDS_JSON}")
    print(f"5. Statistik JSON        : {NDVI_STATS_JSON}")
    print(f"\nThreshold masking        : NDVI > {NDVI_VEGETATION_THRESHOLD}")
    print("(piksel <= threshold dianggap permukiman/non-vegetasi, diabaikan dari mean)")
    print("\nKelas NDVI (visualisasi raster):")
    print("  < 0.0        = air / non-vegetasi (biru)")
    print("  0.0 – 0.1    = non-vegetasi/terbangun (tan)")
    print("  0.1 – 0.3    = vegetasi rendah (kuning)")
    print("  0.3 – 0.5    = vegetasi sedang (hijau muda)")
    print("  > 0.5        = vegetasi tinggi (hijau tua)")
    print("\nKelas NDVI (per kecamatan / klasifikasi SPK):")
    print("  < 0.3        = Vegetasi Rendah")
    print("  0.3 – 0.5    = Vegetasi Sedang")
    print("  >= 0.5       = Vegetasi Tinggi")
    print("\nUntuk hitung NDVI per kecamatan dengan masking permukiman:")
    print("  from generate_ndvi import compute_ndvi_per_kecamatan")
    print('  compute_ndvi_per_kecamatan("kecamatan.geojson", "metrics_raw.json")')


if __name__ == "__main__":
    main()