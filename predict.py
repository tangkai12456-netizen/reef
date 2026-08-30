# ============================================================
#  predict.py
#  พยากรณ์ล่วงหน้า "ทุกวัน" ตั้งแต่ +1 ถึง +14 วัน สำหรับจุดพิกัดหนึ่ง ด้วยโมเดล 2 ตัวควบคู่กัน:
#    1) Regressor (dhw_models_multi.pkl)     — พยากรณ์ค่า DHW เป็นตัวเลข
#    2) Classifier (dhw_classifier_multi.pkl) — จำแนกระดับความเสี่ยงฟอกขาว (class 0-3) โดยตรง
#       พร้อมค่าความมั่นใจ (probability) — ทำงานควบคู่กัน ไม่ได้แทนที่กัน
#  เรียกจาก Node.js (server.js) เป็น subprocess ทุกครั้งที่ผู้ใช้เปิดกราฟ 14 วัน
#
#  วิธีใช้ (ทดสอบเองได้):
#      python predict.py <lat> <lon>
#      เช่น: python predict.py 8.657 97.649
#
#  output: พิมพ์ JSON บรรทัดเดียวออก stdout ให้ Node อ่าน (มี array "forecasts" ครบ 14 วัน)
#  ถ้าพยากรณ์ไม่ได้ไม่ว่ากรณีไหน (ข้อมูลไม่พอ/ดึงไม่ได้/ยังไม่มีโมเดล)
#  จะพิมพ์ JSON ที่มี key "error" ออก stdout แล้ว exit code 1
#  — ไม่ปั้นตัวเลขปลอมส่งกลับเด็ดขาด ให้ frontend โชว์ว่าพยากรณ์ไม่ได้แทน
# ============================================================

import json
import sys
from datetime import datetime, timedelta

import pandas as pd
import joblib
import requests

from train_model import (
    ERDDAP_BASE, FEATURE_COLUMNS, MAX_HORIZON,
    MULTI_HORIZON_MODEL_FILE, MULTI_HORIZON_META_FILE,
    CLASSIFIER_MODEL_FILE, CLASSIFIER_META_FILE, RISK_CLASS_LABELS,
)

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

# ต้องมีข้อมูลย้อนหลังอย่างน้อย 30 วันเต็มสำหรับ feature lag30/ma30
# ดึงเผื่อ 40 วัน กันกรณีข้อมูลบางวันขาดหาย
LOOKBACK_DAYS = 40


def fail(message):
    """พิมพ์ error เป็น JSON แล้วจบโปรแกรมด้วย exit code 1 — ไม่มีการปั้นข้อมูลปลอม"""
    print(json.dumps({"error": message}, ensure_ascii=False))
    sys.exit(1)


def fetch_recent(lat, lon):
    """ดึงข้อมูล SST/DHW/SST anomaly ย้อนหลัง ~40 วันล่าสุดของจุดพิกัดที่ขอมา"""
    end_date = datetime.utcnow().date() - timedelta(days=2)  # เผื่อข้อมูลล่าสุดยังไม่อัปเดต
    start_date = end_date - timedelta(days=LOOKBACK_DAYS)
    start_str = start_date.strftime("%Y-%m-%dT12:00:00Z")
    end_str = end_date.strftime("%Y-%m-%dT12:00:00Z")
    url = (
        f"{ERDDAP_BASE}?"
        f"CRW_SST[({start_str}):1:({end_str})][({lat})][({lon})],"
        f"CRW_DHW[({start_str}):1:({end_str})][({lat})][({lon})],"
        f"CRW_SSTANOMALY[({start_str}):1:({end_str})][({lat})][({lon})]"
    )
    try:
        res = requests.get(url, timeout=25)  # PacIOOS บางครั้งตอบช้า 15-20 วิ เผื่อ margin กันไทม์เอาต์ผิดๆ
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        fail(f"ดึงข้อมูลจาก NOAA/PacIOOS ไม่สำเร็จ: {e}")

    cols = data["table"]["columnNames"]
    rows = [dict(zip(cols, r)) for r in data["table"]["rows"]]
    if not rows:
        fail("ไม่มีข้อมูลย้อนหลังสำหรับพิกัดนี้")

    df = pd.DataFrame(rows).rename(columns={
        "CRW_SST": "sst", "CRW_DHW": "dhw", "CRW_SSTANOMALY": "sst_anomaly_raw",
    })
    df["time"] = pd.to_datetime(df["time"])
    df = df.sort_values("time").reset_index(drop=True)
    return df


def build_feature_row(df):
    """สร้าง feature ชุดเดียวกับตอนเทรน (train_model.py) จากข้อมูลล่าสุดที่ดึงมา"""
    if len(df) < 31:
        fail(f"ข้อมูลย้อนหลังไม่พอสร้าง feature (ได้ {len(df)} วัน ต้องการอย่างน้อย 31 วัน)")

    latest = df.iloc[-1]

    def at(n_days_back):
        idx = len(df) - 1 - n_days_back
        return df.iloc[idx] if idx >= 0 else None

    row7, row14, row30 = at(7), at(14), at(30)
    if row7 is None or row14 is None or row30 is None:
        fail("ข้อมูลย้อนหลังไม่พอสร้าง lag feature ครบ 7/14/30 วัน")

    features = {
        "sst": latest["sst"],
        "sst_lag7": row7["sst"],
        "sst_lag14": row14["sst"],
        "sst_lag30": row30["sst"],
        "dhw_lag7": row7["dhw"],
        "dhw_lag14": row14["dhw"],
        "sst_ma7": df["sst"].tail(7).mean(),
        "sst_ma30": df["sst"].tail(30).mean(),
        "sst_anomaly": latest["sst_anomaly_raw"],
        "month": latest["time"].month,
    }

    if any(pd.isna(v) for v in features.values()):
        fail("มี feature เป็นค่าว่าง (NaN) — ข้อมูลดิบที่ดึงมามีช่วงขาดหาย")

    return features, latest


def main():
    if len(sys.argv) != 3:
        fail("ต้องระบุ lat lon เป็น argument เช่น: python predict.py 8.657 97.649")

    try:
        lat, lon = float(sys.argv[1]), float(sys.argv[2])
    except ValueError:
        fail("lat/lon ต้องเป็นตัวเลข")

    try:
        models = joblib.load(MULTI_HORIZON_MODEL_FILE)  # dict: {1: model, 2: model, ..., 14: model}
        with open(MULTI_HORIZON_META_FILE, encoding="utf-8") as f:
            meta = json.load(f)
    except FileNotFoundError:
        fail(f"ยังไม่มีโมเดลรายวันที่เทรนไว้ ({MULTI_HORIZON_MODEL_FILE}/{MULTI_HORIZON_META_FILE}) — รัน train_model.py ก่อน")

    # Classifier เป็นตัวเสริม (ควบคู่กับ Regressor ไม่ใช่แทนที่) — ถ้าไม่มีไฟล์นี้ยังพยากรณ์ค่า DHW ต่อได้ตามปกติ
    # แค่ไม่มีข้อมูลระดับความเสี่ยง+ความมั่นใจแนบมาด้วยเท่านั้น (ไม่ทำให้ทั้ง request ล้มเหลว)
    clf_models, clf_meta = None, None
    try:
        clf_models = joblib.load(CLASSIFIER_MODEL_FILE)
        with open(CLASSIFIER_META_FILE, encoding="utf-8") as f:
            clf_meta = json.load(f)
    except FileNotFoundError:
        pass

    df = fetch_recent(lat, lon)
    features, latest_row = build_feature_row(df)
    X = pd.DataFrame([features])[FEATURE_COLUMNS]

    scores_by_horizon = meta.get("scores_by_horizon", {})
    clf_scores_by_horizon = (clf_meta or {}).get("scores_by_horizon", {})

    forecasts = []
    for h in range(1, MAX_HORIZON + 1):
        model = models[h]
        predicted_dhw = max(0.0, float(model.predict(X)[0]))  # DHW ติดลบไม่ได้ทางฟิสิกส์
        forecast_date = (latest_row["time"] + timedelta(days=h)).strftime("%Y-%m-%d")

        entry = {
            "horizon_days": h,
            "date": forecast_date,
            "predicted_dhw": round(predicted_dhw, 2),
            "mae": scores_by_horizon.get(str(h), {}).get("mae"),
        }

        # เพิ่มผลจาก Classifier (ระดับความเสี่ยง + ความมั่นใจ) ถ้ามีโมเดลนี้อยู่
        if clf_models is not None and h in clf_models:
            clf = clf_models[h]
            pred_class = int(clf.predict(X)[0])
            proba = clf.predict_proba(X)[0]
            # ดึงความมั่นใจของ class ที่ทำนาย — ใช้ clf.classes_ เพราะบาง horizon
            # โมเดลอาจไม่เคยเห็น class ใดเลยตอนเทรน (predict_proba จะไม่มีคอลัมน์ของ class นั้น)
            class_idx = list(clf.classes_).index(pred_class)
            confidence = float(proba[class_idx])
            entry["risk_class"] = pred_class
            entry["risk_label"] = RISK_CLASS_LABELS[pred_class]
            entry["risk_confidence"] = round(confidence, 3)
            entry["classifier_accuracy"] = clf_scores_by_horizon.get(str(h), {}).get("accuracy")

        forecasts.append(entry)

    print(json.dumps({
        "current_dhw": float(latest_row["dhw"]),
        "current_date": latest_row["time"].strftime("%Y-%m-%d"),
        "model_used": meta.get("model_type", "Random Forest (per-horizon)"),
        "classifier_used": (clf_meta or {}).get("model_type"),
        "forecasts": forecasts,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
