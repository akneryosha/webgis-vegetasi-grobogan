import csv
import json
import os
import re
import sys
from typing import Dict, List, Optional, Tuple


METRIC_FILE_PATTERN = re.compile(r"^metrics_(\d{4}-\d{2}-\d{2})\.json$")


def safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (ValueError, TypeError):
        return default


def classify_ndvi_status(ndvi: float) -> str:
    """
    Klasifikasi status NDVI per kecamatan.
    Label diselaraskan dengan scoring.js (classifyNdviStatus) agar konsisten
    antara data JSON dan tampilan frontend.

    Referensi threshold: Brillyansyah et al. (2024), Utomo et al. (2022)
    """
    if ndvi >= 0.5:
        return "Vegetasi Tinggi"
    if ndvi >= 0.3:
        return "Vegetasi Sedang"
    return "Vegetasi Rendah"


def classify_anomaly(delta: Optional[float], epsilon: float = 0.0001) -> str:
    if delta is None:
        return "Tidak Ada Data Pembanding"
    if delta > epsilon:
        return "Meningkat"
    if delta < -epsilon:
        return "Menurun"
    return "Stabil"


def classify_saw_score(score: float) -> str:
    if score >= 0.7:
        return "Aman"
    if score >= 0.4:
        return "Waspada"
    return "Kritis"


def clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def normalize_benefit(value: float, min_value: float, max_value: float) -> float:
    if max_value == min_value:
        return 1.0
    return clamp01((value - min_value) / (max_value - min_value))


def normalize_cost(value: float, min_value: float, max_value: float) -> float:
    if max_value == min_value:
        return 1.0
    return clamp01((max_value - value) / (max_value - min_value))


def compute_saw_score(item: dict) -> float:
    ndvi = safe_float(item.get("ndvi_mean"), 0.0)
    rainfall = safe_float(item.get("rainfall"), 0.0)
    humidity = safe_float(item.get("humidity"), 0.0)
    temperature = safe_float(item.get("temperature"), 0.0)

    ndvi_norm = normalize_benefit(ndvi, 0.0, 1.0)
    rainfall_norm = normalize_benefit(rainfall, 0.0, 30.0)
    humidity_norm = normalize_benefit(humidity, 40.0, 100.0)
    temperature_norm = normalize_cost(temperature, 20.0, 40.0)

    score = (
        ndvi_norm * 0.5
        + rainfall_norm * 0.2
        + humidity_norm * 0.2
        + temperature_norm * 0.1
    )
    return round(score, 4)


def read_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_weather_value(row: dict, possible_keys: List[str], default=0.0) -> float:
    for key in possible_keys:
        if key in row:
            return safe_float(row.get(key), default)
    return default


def load_weather_csv(csv_path: str) -> Dict[str, dict]:
    weather_by_date: Dict[str, dict] = {}

    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        if reader.fieldnames is None:
            raise ValueError("CSV cuaca tidak memiliki header.")

        for row in reader:
            raw_date = (
                row.get("date")
                or row.get("tanggal")
                or row.get("Date")
                or row.get("Tanggal")
            )

            if not raw_date:
                continue

            date_str = raw_date.strip()

            weather_by_date[date_str] = {
                "temperature": round(
                    get_weather_value(
                        row,
                        ["temperature_mean_c", "temperature", "temp_mean", "temp"],
                        0.0,
                    ),
                    2,
                ),
                "temperature_min": round(
                    get_weather_value(
                        row,
                        ["temperature_min_c", "temp_min", "min_temp"],
                        0.0,
                    ),
                    2,
                ),
                "temperature_max": round(
                    get_weather_value(
                        row,
                        ["temperature_max_c", "temp_max", "max_temp"],
                        0.0,
                    ),
                    2,
                ),
                "humidity": round(
                    get_weather_value(
                        row,
                        ["humidity_mean_percent", "humidity", "kelembapan"],
                        0.0,
                    ),
                    2,
                ),
                "rainfall": round(
                    get_weather_value(
                        row,
                        ["rainfall_sum_mm", "rainfall", "curah_hujan"],
                        0.0,
                    ),
                    2,
                ),
                "windspeed_kmh": round(
                    get_weather_value(
                        row,
                        ["windspeed_mean_kmh", "windspeed_kmh", "wind_kmh"],
                        0.0,
                    ),
                    2,
                ),
                "windspeed_mps": round(
                    get_weather_value(
                        row,
                        ["windspeed_mean_mps", "windspeed_mps", "wind_mps"],
                        0.0,
                    ),
                    2,
                ),
            }

    return weather_by_date


def list_metric_files(data_dir: str) -> List[Tuple[str, str]]:
    results = []

    for filename in os.listdir(data_dir):
        match = METRIC_FILE_PATTERN.match(filename)
        if match:
            date_str = match.group(1)
            results.append((date_str, filename))

    results.sort(key=lambda x: x[0])
    return results


def get_item_key(item: dict) -> str:
    for key in ["id", "kode", "kode_kecamatan", "kecamatan"]:
        value = item.get(key)
        if value is not None:
            return str(value)
    return ""


def finalize_metrics(data_dir: str, weather_csv_path: str):
    if not os.path.isdir(data_dir):
        raise FileNotFoundError(f"Folder data tidak ditemukan: {data_dir}")

    if not os.path.isfile(weather_csv_path):
        raise FileNotFoundError(f"File CSV cuaca tidak ditemukan: {weather_csv_path}")

    weather_by_date = load_weather_csv(weather_csv_path)
    metric_files = list_metric_files(data_dir)

    if not metric_files:
        raise FileNotFoundError("Tidak ada file metrics_YYYY-MM-DD.json di folder data.")

    previous_metrics_map: Optional[Dict[str, dict]] = None

    print("=== FINALIZE METRICS ===")
    print(f"Folder data     : {data_dir}")
    print(f"CSV cuaca       : {weather_csv_path}")
    print(f"Jumlah metrics  : {len(metric_files)}")
    print("")

    for date_str, filename in metric_files:
        filepath = os.path.join(data_dir, filename)
        data = read_json(filepath)

        if not isinstance(data, list):
            print(f"[SKIP] {filename} bukan array JSON.")
            previous_metrics_map = None
            continue

        weather = weather_by_date.get(date_str)
        if not weather:
            print(f"[SKIP] Tidak ada data cuaca untuk tanggal {date_str} ({filename})")
            previous_metrics_map = None
            continue

        current_metrics_map: Dict[str, dict] = {}

        for item in data:
            if not isinstance(item, dict):
                continue

            ndvi_mean = round(safe_float(item.get("ndvi_mean"), 0.0), 4)
            item["ndvi_mean"] = ndvi_mean
            item["status"] = classify_ndvi_status(ndvi_mean)

            item["temperature"] = weather["temperature"]
            item["temperature_min"] = weather["temperature_min"]
            item["temperature_max"] = weather["temperature_max"]
            item["humidity"] = weather["humidity"]
            item["rainfall"] = weather["rainfall"]
            item["windspeed_kmh"] = weather["windspeed_kmh"]
            item["windspeed_mps"] = weather["windspeed_mps"]

            item_key = get_item_key(item)

            ndvi_delta: Optional[float] = None
            if previous_metrics_map and item_key in previous_metrics_map:
                prev_ndvi = safe_float(previous_metrics_map[item_key].get("ndvi_mean"), 0.0)
                ndvi_delta = round(ndvi_mean - prev_ndvi, 4)

            item["ndvi_delta"] = ndvi_delta
            item["anomaly"] = classify_anomaly(ndvi_delta)

            score = compute_saw_score(item)
            item["score"] = score
            item["saw_status"] = classify_saw_score(score)

            current_metrics_map[item_key] = {
                "ndvi_mean": ndvi_mean
            }

        write_json(filepath, data)
        previous_metrics_map = current_metrics_map

        print(f"[OK] {filename} diperbarui")

    print("")
    print("Selesai. Semua metrics yang cocok dengan tanggal CSV sudah dibuat versi final.")


def print_usage():
    print("Cara pakai:")
    print('python finalize_metrics.py "C:\\path\\ke\\webgis\\data" "C:\\path\\ke\\weather_data.csv"')


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print_usage()
        sys.exit(1)

    data_dir_arg = sys.argv[1]
    weather_csv_arg = sys.argv[2]

    try:
        finalize_metrics(data_dir_arg, weather_csv_arg)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)