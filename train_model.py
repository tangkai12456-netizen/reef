# ============================================================
#  train_model.py
#  เทรนโมเดล Machine Learning พยากรณ์ DHW (Degree Heating Weeks) ให้แอป ReefAlert
#
#  หมายเหตุสำคัญ: ก่อนหน้านี้แอปนี้ "ไม่มี" ระบบพยากรณ์ DHW เลย
#  (ค่า DHW ที่แสดงในแอปคือค่าปัจจุบันจริงจากดาวเทียม ไม่ใช่การพยากรณ์)
#  สคริปต์นี้คือการสร้างฟีเจอร์ "พยากรณ์ล่วงหน้า" ขึ้นมาใหม่ ทำ 3 ชุด:
#    1) โมเดลจุดเดียวที่ +14 วัน เปรียบเทียบ 3 อัลกอริทึม (Linear/RF/GB) — ใช้เป็นข้อมูลอ้างอิง
#    2) Regressor รายวันครบ +1 ถึง +14 วัน (Random Forest แยกทีละ horizon) — พยากรณ์ค่า DHW ตัวเลข
#       (แก้ปัญหาที่โมเดลเดี่ยวพยากรณ์ได้แค่จุดเดียว ทำให้กราฟมีช่องว่างวันที่ 11-13)
#    3) Classifier รายวันครบ +1 ถึง +14 วัน (RandomForestClassifier แยกทีละ horizon) — จำแนก
#       "ระดับความเสี่ยงฟอกขาว" (class 0-3 ตามเกณฑ์ NOAA) โดยตรง ทำงานควบคู่กับ Regressor ไม่ได้แทนที่
#
#  แหล่งข้อมูล: NOAA Coral Reef Watch (CRW) 5km product
#  ผ่าน PacIOOS ERDDAP mirror (เพราะ endpoint ของ NOAA เองมีปัญหา CORS/ไม่ตอบสนอง)
#  https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km
#
#  วิธีรัน:
#      python train_model.py
#
#  ผลลัพธ์ที่ได้:
#      dhw_training_data.csv        ข้อมูลดิบที่ดึงมา (cache ไว้ รันซ้ำไม่ต้องดึงใหม่)
#      dhw_model.pkl                โมเดลจุดเดียว +14 วัน ที่ดีที่สุดหลังเปรียบเทียบ 3 แบบ (ไว้อ้างอิง)
#      dhw_model_meta.json          ข้อมูลประกอบของโมเดลจุดเดียว
#      dhw_models_multi.pkl         Regressor รายวันครบ +1 ถึง +14 วัน — ตัวที่ predict.py ใช้พยากรณ์ค่า DHW จริง
#      dhw_models_multi_meta.json   ข้อมูลประกอบ + MAE ของแต่ละ horizon
#      dhw_classifier_multi.pkl     Classifier รายวันครบ +1 ถึง +14 วัน — ตัวที่ predict.py ใช้จำแนกระดับความเสี่ยงจริง
#      dhw_classifier_multi_meta.json ข้อมูลประกอบ + accuracy/precision/recall/f1/confusion matrix ของแต่ละ horizon
# ============================================================

import json
import os
import sys
import time
from datetime import datetime, timedelta

# Windows console เป็น cp1252 โดยดีฟอลต์ พิมพ์ emoji/ภาษาไทยไม่ได้ — บังคับ stdout เป็น UTF-8
if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

import numpy as np
import pandas as pd
import requests
import joblib
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, RandomForestClassifier
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error,
    accuracy_score, classification_report, confusion_matrix,
)

# ===== ค่าคงที่ / ตั้งค่า =====

# จุดปะการังทั้ง 8 แห่ง (พิกัดตรงกับ REEFS ใน app.js ของแอป)
REEFS = [
    {"id": 1, "name": "หมู่เกาะสิมิลัน",       "lat": 8.657,  "lon": 97.649},
    {"id": 2, "name": "เกาะเต่า",               "lat": 10.066, "lon": 99.839},
    {"id": 3, "name": "เกาะหลีเป๊ะ",            "lat": 6.487,  "lon": 99.303},
    {"id": 4, "name": "เกาะสมุย (Coral Cove)", "lat": 9.491,  "lon": 100.061},
    {"id": 5, "name": "เกาะช้าง",               "lat": 12.125, "lon": 102.269},
    {"id": 6, "name": "เกาะพีพี (Shark Point)","lat": 7.726,  "lon": 98.788},
    {"id": 7, "name": "เกาะราชา",               "lat": 7.604,  "lon": 98.366},
    {"id": 8, "name": "เกาะตะรุเตา",            "lat": 6.649,  "lon": 99.652},
]

ERDDAP_BASE = "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.json"

TRAIN_YEARS = 10         # ดึงข้อมูลย้อนหลังกี่ปีมาเทรน — ขยายจาก 2 เป็น 10 ปี (2016-2026)
                         # เพื่อครอบคลุมเหตุการณ์ฟอกขาวระดับโลกจริง (2016-17, 2020, 2023-24)
                         # แก้ปัญหา class "สูง"/"วิกฤต" ของ classifier แทบไม่มีตัวอย่างเทรนเลยตอนใช้แค่ 2 ปี
CHUNK_DAYS = 90          # แบ่งดึงทีละกี่วัน — ดึงทีเดียวเป็นปีจะ timeout เพราะ
                         # server ฟรีตัวนี้ (PacIOOS mirror) รับโหลดคำขอใหญ่ๆ ไม่ไหว
                         # (ทดสอบแล้ว: ช่วง 90 วันเสถียร, ช่วง 1 ปีเต็ม timeout)
FORECAST_HORIZON = 14    # พยากรณ์ล่วงหน้ากี่วัน (สำหรับโมเดลจุดเดียว) — ต้องตรงกับที่หน้าเว็บต้องการ (แท็บ "14 วัน")
MAX_HORIZON = 14         # โมเดลรายวัน: เทรนแยกทีละ horizon ตั้งแต่ +1 ถึง +MAX_HORIZON วัน

CACHE_FILE = "dhw_training_data.csv"
MODEL_FILE = "dhw_model.pkl"
META_FILE = "dhw_model_meta.json"
MULTI_HORIZON_MODEL_FILE = "dhw_models_multi.pkl"
MULTI_HORIZON_META_FILE = "dhw_models_multi_meta.json"
CLASSIFIER_MODEL_FILE = "dhw_classifier_multi.pkl"
CLASSIFIER_META_FILE = "dhw_classifier_multi_meta.json"

# ระดับความเสี่ยงฟอกขาวตามเกณฑ์ NOAA Bleaching Alert Level (ใช้เกณฑ์เดียวกับ getRisk() ใน app.js)
RISK_CLASS_LABELS = {0: "ปกติ", 1: "เฝ้าระวัง", 2: "สูง", 3: "วิกฤต"}

FEATURE_COLUMNS = [
    "sst",                # SST ปัจจุบัน
    "sst_lag7",           # SST ย้อนหลัง 7 วัน
    "sst_lag14",          # SST ย้อนหลัง 14 วัน
    "sst_lag30",          # SST ย้อนหลัง 30 วัน
    "dhw_lag7",           # DHW ย้อนหลัง 7 วัน
    "dhw_lag14",          # DHW ย้อนหลัง 14 วัน
    "sst_ma7",            # ค่าเฉลี่ยเคลื่อนที่ SST 7 วัน
    "sst_ma30",           # ค่าเฉลี่ยเคลื่อนที่ SST 30 วัน
    "sst_anomaly",        # SST anomaly (NOAA คำนวณมาให้แล้ว — CRW_SSTANOMALY)
    "month",              # เดือน (จับ pattern ตามฤดูกาล)
]
TARGET_COLUMN = "dhw_future_14d"


# ===== ขั้นตอนที่ 1: ดึงข้อมูลย้อนหลังจาก NOAA/PacIOOS ERDDAP =====

def fetch_chunk(lat, lon, start_date, end_date, retries=3):
    """
    ดึงข้อมูล SST + DHW + SST anomaly รายวัน ของจุดพิกัดหนึ่ง ในช่วงเวลาหนึ่ง
    ทำ retry เพราะ ERDDAP มิเรอร์ฟรีตัวนี้บางครั้งไม่ตอบสนอง (พบระหว่างพัฒนา)
    """
    start_str = start_date.strftime("%Y-%m-%dT12:00:00Z")
    end_str = end_date.strftime("%Y-%m-%dT12:00:00Z")
    url = (
        f"{ERDDAP_BASE}?"
        f"CRW_SST[({start_str}):1:({end_str})][({lat})][({lon})],"
        f"CRW_DHW[({start_str}):1:({end_str})][({lat})][({lon})],"
        f"CRW_SSTANOMALY[({start_str}):1:({end_str})][({lat})][({lon})]"
    )
    for attempt in range(1, retries + 1):
        try:
            res = requests.get(url, timeout=25)
            res.raise_for_status()
            return res.json()
        except Exception as e:
            print(f"      ⚠️ ลองครั้งที่ {attempt}/{retries} ไม่สำเร็จ: {e}")
            time.sleep(2)
    return None


def fetch_reef_history(reef, years):
    """ดึงข้อมูลย้อนหลังทั้งหมดของจุดปะการังหนึ่งจุด โดยแบ่งดึงเป็นช่วงย่อยๆ (chunk)"""
    end_date = datetime.utcnow().date() - timedelta(days=2)  # เผื่อข้อมูลล่าสุดยังไม่อัปเดต
    start_date = end_date - timedelta(days=365 * years)

    all_rows = []
    chunk_start = start_date
    while chunk_start < end_date:
        chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS), end_date)
        print(f"    ดึงช่วง {chunk_start} ถึง {chunk_end} ...")
        data = fetch_chunk(reef["lat"], reef["lon"], chunk_start, chunk_end)
        if data and "table" in data:
            cols = data["table"]["columnNames"]
            for row in data["table"]["rows"]:
                record = dict(zip(cols, row))
                all_rows.append(record)
        else:
            print(f"    ❌ ดึงช่วงนี้ไม่สำเร็จเลยหลัง retry — ข้ามช่วงนี้ไป")
        chunk_start = chunk_end
        time.sleep(1)  # เว้นจังหวะ ไม่ยิง request รัวๆ ใส่ server ฟรี

    if not all_rows:
        return None

    df = pd.DataFrame(all_rows)
    df["reef_id"] = reef["id"]
    df["reef_name"] = reef["name"]
    return df


def build_training_dataset():
    """ดึงข้อมูลทุกจุดปะการัง รวมเป็น DataFrame เดียว (ใช้ cache ถ้ามีไฟล์อยู่แล้ว)"""
    if os.path.exists(CACHE_FILE):
        print(f"📂 พบไฟล์ cache '{CACHE_FILE}' อยู่แล้ว ใช้ข้อมูลนี้แทนการดึงใหม่")
        print(f"   (ถ้าต้องการดึงข้อมูลใหม่ ให้ลบไฟล์นี้ทิ้งก่อนรันสคริปต์)")
        return pd.read_csv(CACHE_FILE, parse_dates=["time"])

    print(f"🌊 เริ่มดึงข้อมูลย้อนหลัง {TRAIN_YEARS} ปี จาก NOAA Coral Reef Watch (ผ่าน PacIOOS ERDDAP)")
    print(f"   สำหรับปะการังทั้งหมด {len(REEFS)} จุด (แบ่งดึงทีละ {CHUNK_DAYS} วัน กัน server timeout)\n")

    all_dfs = []
    for reef in REEFS:
        print(f"📍 {reef['name']} ({reef['lat']}, {reef['lon']})")
        df = fetch_reef_history(reef, TRAIN_YEARS)
        if df is None or df.empty:
            print(f"   ❌ ไม่สามารถดึงข้อมูลจุดนี้ได้เลย — ข้ามจุดนี้ไป\n")
            continue
        print(f"   ✅ ได้ {len(df)} แถว\n")
        all_dfs.append(df)

    if not all_dfs:
        return None

    full_df = pd.concat(all_dfs, ignore_index=True)
    full_df.to_csv(CACHE_FILE, index=False)
    print(f"💾 บันทึกข้อมูลดิบไว้ที่ '{CACHE_FILE}' ({len(full_df)} แถวรวม) เผื่อรันซ้ำครั้งหน้า\n")
    return full_df


# ===== ขั้นตอนที่ 2: สร้าง Feature และ Target =====

def engineer_features(raw_df):
    """
    สร้าง feature ต่างๆ จากข้อมูลดิบ (แยกคำนวณทีละจุดปะการัง เพราะ lag/moving-average
    ต้องเรียงตามเวลาของแต่ละจุดเอง ห้ามปนกันข้ามจุด)
    """
    raw_df = raw_df.rename(columns={
        "CRW_SST": "sst", "CRW_DHW": "dhw", "CRW_SSTANOMALY": "sst_anomaly_raw",
    })
    raw_df["time"] = pd.to_datetime(raw_df["time"])

    processed = []
    for reef_id, g in raw_df.groupby("reef_id"):
        g = g.sort_values("time").reset_index(drop=True)

        g["sst_lag7"]  = g["sst"].shift(7)
        g["sst_lag14"] = g["sst"].shift(14)
        g["sst_lag30"] = g["sst"].shift(30)
        g["dhw_lag7"]  = g["dhw"].shift(7)
        g["dhw_lag14"] = g["dhw"].shift(14)
        g["sst_ma7"]   = g["sst"].rolling(window=7).mean()
        g["sst_ma30"]  = g["sst"].rolling(window=30).mean()
        g["sst_anomaly"] = g["sst_anomaly_raw"]  # NOAA คำนวณมาให้แล้ว ไม่ต้องคำนวณเอง
        g["month"] = g["time"].dt.month

        # target หลายระยะ: dhw_future_1d ... dhw_future_{MAX_HORIZON}d
        # (ทำไว้ทุก horizon ในขั้นตอนเดียว เพราะ target แต่ละตัวมี NaN ท้ายตารางไม่เท่ากัน
        #  จะไปตัดแถวทีหลังตอนเทรนแต่ละ horizon แยกกัน ไม่ตัดรวมตรงนี้)
        for h in range(1, MAX_HORIZON + 1):
            g[f"dhw_future_{h}d"] = g["dhw"].shift(-h)

        processed.append(g)

    df = pd.concat(processed, ignore_index=True)
    before = len(df)
    df = df.dropna(subset=FEATURE_COLUMNS)  # ตัดเฉพาะแถวที่ feature (lag/ma) ไม่ครบ เช่นช่วงต้นตาราง
    after = len(df)
    print(f"🧹 ตัดแถวที่ feature ไม่ครบ (เช่นช่วงต้นที่ทำ lag ไม่ได้): {before} → {after} แถว")
    return df


# ===== ขั้นตอนที่ 3: เทรนโมเดล + เปรียบเทียบ =====

def time_series_split(df, test_ratio=0.2):
    """
    แบ่ง train/test แบบ time-series (ห้าม shuffle เด็ดขาด เพราะเป็นข้อมูลอนุกรมเวลา
    ถ้า shuffle จะเอาอนาคตมาช่วยทำนายอดีต ผลลัพธ์จะดูดีเกินจริง)
    เรียงตามเวลาก่อน แล้วตัดท้ายสุดเป็น test set
    """
    df = df.sort_values("time").reset_index(drop=True)
    split_idx = int(len(df) * (1 - test_ratio))
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]
    return train_df, test_df


def evaluate(name, model, X_test, y_test):
    pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, pred)
    rmse = np.sqrt(mean_squared_error(y_test, pred))
    print(f"   {name:22s}  MAE = {mae:.4f}   RMSE = {rmse:.4f}")
    return mae, rmse


def train_and_compare(df):
    # ตัดแถวที่ target +14 วันไม่มี (เช่น 14 แถวสุดท้ายของแต่ละจุดปะการังที่ shift(-14) แล้วเป็น NaN)
    df = df.dropna(subset=[TARGET_COLUMN])
    train_df, test_df = time_series_split(df)
    print(f"\n📊 แบ่งข้อมูล: เทรน {len(train_df)} แถว / ทดสอบ {len(test_df)} แถว (time-series split ไม่ shuffle)")

    X_train, y_train = train_df[FEATURE_COLUMNS], train_df[TARGET_COLUMN]
    X_test, y_test = test_df[FEATURE_COLUMNS], test_df[TARGET_COLUMN]

    print("\n🤖 เทรนโมเดล 3 แบบ แล้วเทียบผลบน test set เดียวกัน:\n")

    results = {}

    lr = LinearRegression()
    lr.fit(X_train, y_train)
    results["Linear Regression (baseline)"] = (lr, *evaluate("Linear Regression (baseline)", lr, X_test, y_test))

    rf = RandomForestRegressor(n_estimators=300, max_depth=10, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    results["Random Forest"] = (rf, *evaluate("Random Forest", rf, X_test, y_test))

    gb = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05, random_state=42)
    gb.fit(X_train, y_train)
    results["Gradient Boosting"] = (gb, *evaluate("Gradient Boosting", gb, X_test, y_test))

    # เลือกโมเดลที่ MAE ต่ำที่สุด
    best_name = min(results, key=lambda k: results[k][1])
    best_model, best_mae, best_rmse = results[best_name]
    print(f"\n🏆 โมเดลที่ดีที่สุด: {best_name}  (MAE = {best_mae:.4f}, RMSE = {best_rmse:.4f})")

    # Feature importance (เฉพาะโมเดล tree-based ที่มี attribute นี้)
    if hasattr(best_model, "feature_importances_"):
        print("\n📈 ความสำคัญของแต่ละ feature (feature importance):")
        importances = sorted(
            zip(FEATURE_COLUMNS, best_model.feature_importances_),
            key=lambda x: x[1], reverse=True
        )
        for feat, imp in importances:
            bar = "█" * int(imp * 50)
            print(f"   {feat:14s} {imp:.4f}  {bar}")
    elif hasattr(best_model, "coef_"):
        print("\n📈 ค่าสัมประสิทธิ์ (coefficient) ของแต่ละ feature (Linear Regression):")
        for feat, coef in zip(FEATURE_COLUMNS, best_model.coef_):
            print(f"   {feat:14s} {coef:+.4f}")

    return best_name, best_model, {k: (v[1], v[2]) for k, v in results.items()}


# ===== ขั้นตอนที่ 4: บันทึกโมเดล =====

def save_model(best_name, best_model, all_scores, df):
    joblib.dump(best_model, MODEL_FILE)

    # เก็บ feature importance (ถ้าโมเดลมี attribute นี้) ไว้ใน meta ด้วย
    # เพื่อให้หน้าเว็บ /methodology ดึงไปแสดงเป็นกราฟแท่งได้จากข้อมูลจริง ไม่ต้อง hardcode
    feature_importances = None
    if hasattr(best_model, "feature_importances_"):
        feature_importances = {
            feat: float(imp) for feat, imp in zip(FEATURE_COLUMNS, best_model.feature_importances_)
        }
    elif hasattr(best_model, "coef_"):
        feature_importances = {
            feat: float(coef) for feat, coef in zip(FEATURE_COLUMNS, best_model.coef_)
        }

    meta = {
        "best_model": best_name,
        "feature_columns": FEATURE_COLUMNS,
        "feature_importances": feature_importances,
        "target_column": TARGET_COLUMN,
        "forecast_horizon_days": FORECAST_HORIZON,
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "training_rows": len(df),
        "date_range": {
            "start": str(df["time"].min()),
            "end": str(df["time"].max()),
        },
        "scores": {name: {"mae": mae, "rmse": rmse} for name, (mae, rmse) in all_scores.items()},
    }
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n💾 บันทึกโมเดลไว้ที่ '{MODEL_FILE}'")
    print(f"💾 บันทึกข้อมูลประกอบไว้ที่ '{META_FILE}' (predict.py จะโหลดไฟล์นี้ไปใช้ตอนพยากรณ์จริง)")


# ===== ขั้นตอนที่ 5: เทรนโมเดลรายวันครบ +1 ถึง +14 วัน =====
# แก้ปัญหาที่โมเดลจุดเดียว (train_and_compare) พยากรณ์ได้แค่ +14 วันจุดเดียว ทำให้กราฟมีช่องว่าง
# วิธี A ตามที่ตกลงกัน: เทรน Random Forest แยกทีละ horizon (feature set เดียวกัน เปลี่ยนแค่ target)
# ข้อดีกว่า recursive prediction (วิธี B): ไม่มี error สะสม เพราะแต่ละ horizon เทรนตรงจากข้อมูลจริง
# ไม่ใช่เอาผลพยากรณ์ของ horizon ก่อนหน้ามาป้อนต่อ

def train_multi_horizon(df):
    print(f"\n🔮 เทรนโมเดลพยากรณ์รายวัน +1 ถึง +{MAX_HORIZON} วัน (Random Forest แยกทีละ horizon)\n")

    models = {}
    scores = {}

    for h in range(1, MAX_HORIZON + 1):
        target_col = f"dhw_future_{h}d"
        # แต่ละ horizon ตัดเฉพาะแถวที่ target ของ horizon นั้นไม่มี (NaN ท้ายตารางยาวไม่เท่ากันตาม h)
        df_h = df.dropna(subset=[target_col])
        train_df, test_df = time_series_split(df_h)

        X_train, y_train = train_df[FEATURE_COLUMNS], train_df[target_col]
        X_test, y_test = test_df[FEATURE_COLUMNS], test_df[target_col]

        model = RandomForestRegressor(n_estimators=300, max_depth=10, random_state=42, n_jobs=-1)
        model.fit(X_train, y_train)

        pred = model.predict(X_test)
        mae = mean_absolute_error(y_test, pred)
        rmse = np.sqrt(mean_squared_error(y_test, pred))

        print(f"   +{h:2d} วัน   MAE = {mae:.4f}   RMSE = {rmse:.4f}   (เทรน {len(train_df)} / ทดสอบ {len(test_df)} แถว)")

        models[h] = model
        scores[h] = {"mae": mae, "rmse": rmse, "train_rows": len(train_df), "test_rows": len(test_df)}

    print("\n📈 สรุป MAE ตามระยะพยากรณ์ (ยิ่งไกลจากวันนี้ ควรยิ่งคลาดเคลื่อนมากขึ้นเรื่อยๆ ถ้าโมเดลทำงานสมเหตุสมผล):")
    for h in range(1, MAX_HORIZON + 1):
        bar = "█" * int(scores[h]["mae"] * 20)
        print(f"   +{h:2d} วัน   MAE={scores[h]['mae']:.4f}  {bar}")

    return models, scores


def save_multi_horizon(models, scores, df):
    joblib.dump(models, MULTI_HORIZON_MODEL_FILE)

    meta = {
        "feature_columns": FEATURE_COLUMNS,
        "max_horizon_days": MAX_HORIZON,
        "model_type": "RandomForestRegressor (แยกโมเดลทีละ horizon)",
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "training_rows_total": len(df),
        "date_range": {
            "start": str(df["time"].min()),
            "end": str(df["time"].max()),
        },
        "scores_by_horizon": {str(h): s for h, s in scores.items()},
    }
    with open(MULTI_HORIZON_META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n💾 บันทึกโมเดลรายวันไว้ที่ '{MULTI_HORIZON_MODEL_FILE}' (dict ของ {MAX_HORIZON} โมเดล คีย์ = จำนวนวันข้างหน้า)")
    print(f"💾 บันทึกข้อมูลประกอบไว้ที่ '{MULTI_HORIZON_META_FILE}' (predict.py จะโหลดไฟล์นี้ไปพยากรณ์ครบทุกวัน)")


# ===== ขั้นตอนที่ 6: เทรน Classifier จำแนกระดับความเสี่ยงฟอกขาว (ทำงานควบคู่กับ Regressor ไม่ใช่แทนที่) =====

def dhw_to_risk_class(dhw):
    """แปลงค่า DHW เป็น class ตามเกณฑ์ NOAA Bleaching Alert Level (เกณฑ์เดียวกับ getRisk() ใน app.js)"""
    if dhw >= 8:
        return 3  # วิกฤต (Alert Level 2)
    if dhw >= 4:
        return 2  # สูง (Alert Level 1)
    if dhw >= 1:
        return 1  # เฝ้าระวัง (Watch)
    return 0      # ปกติ (No Stress)


def train_multi_horizon_classifier(df):
    """
    เทรน RandomForestClassifier แยกทีละ horizon (+1 ถึง +MAX_HORIZON วัน) เพื่อจำแนก
    "ระดับความเสี่ยงฟอกขาว" (class 0-3) โดยตรง แทนที่จะต้องพยากรณ์ค่า DHW ตัวเลขก่อนแล้วค่อยแปลงเป็น class ทีหลัง

    ใช้ features และข้อมูล (df) ชุดเดียวกับที่เทรน Regressor (train_multi_horizon) ไม่ได้ดึงข้อมูลใหม่
    ทำงาน "ควบคู่" กับ Regressor เดิม — ไม่ได้แทนที่ค่า DHW ตัวเลขที่ Regressor ทำนายไว้

    class_weight='balanced' เพราะคาดว่า class "วิกฤต" (DHW>=8) จะมีตัวอย่างน้อยกว่า class อื่นมาก
    (เหตุการณ์ฟอกขาวรุนแรงเกิดไม่บ่อยเท่าช่วงปกติ) ถ้าไม่ balance โมเดลจะเอนเอียงไปทายแต่ class ที่พบบ่อย
    """
    print(f"\n🏷️  เทรน Classifier จำแนกระดับความเสี่ยงฟอกขาว +1 ถึง +{MAX_HORIZON} วัน (RandomForestClassifier แยกทีละ horizon)\n")

    models = {}
    scores = {}

    for h in range(1, MAX_HORIZON + 1):
        target_col = f"dhw_future_{h}d"
        df_h = df.dropna(subset=[target_col]).copy()
        df_h["risk_class"] = df_h[target_col].apply(dhw_to_risk_class)

        train_df, test_df = time_series_split(df_h)
        X_train, y_train = train_df[FEATURE_COLUMNS], train_df["risk_class"]
        X_test, y_test = test_df[FEATURE_COLUMNS], test_df["risk_class"]

        # รายงานจำนวนตัวอย่างแต่ละ class ก่อนเทรนเสมอ — ต้องเห็น imbalance ตรงๆ ไม่ซ่อนไว้
        train_counts = y_train.value_counts()
        test_counts = y_test.value_counts()
        print(f"   ── horizon +{h} วัน ──")
        print("   จำนวนตัวอย่าง (เทรน): " +
              ", ".join(f"{RISK_CLASS_LABELS[c]}={int(train_counts.get(c, 0))}" for c in range(4)))
        print("   จำนวนตัวอย่าง (ทดสอบ): " +
              ", ".join(f"{RISK_CLASS_LABELS[c]}={int(test_counts.get(c, 0))}" for c in range(4)))

        classes_in_train = set(y_train.unique())
        missing_in_train = [c for c in range(4) if c not in classes_in_train]
        classes_in_test = set(y_test.unique())
        missing_in_test = [c for c in range(4) if c not in classes_in_test]

        if missing_in_train:
            print(f"   ⚠️ ไม่มีตัวอย่าง class {[RISK_CLASS_LABELS[c] for c in missing_in_train]} เลยในชุดเทรน "
                  f"— โมเดล horizon นี้จะทำนาย class ดังกล่าวไม่ได้เลย (ไม่ใช่ข้อมูลเทียม ไม่ได้ปั้นให้มี)")
        if missing_in_test:
            print(f"   ⚠️ ไม่มีตัวอย่าง class {[RISK_CLASS_LABELS[c] for c in missing_in_test]} เลยในชุดทดสอบ "
                  f"— วัดผล precision/recall ของ class นั้นที่ horizon นี้ไม่ได้ (จะรายงานว่า 'วัดผลไม่ได้' ตรงๆ)")

        clf = RandomForestClassifier(
            n_estimators=300, max_depth=10, class_weight="balanced",
            random_state=42, n_jobs=-1,
        )
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)

        acc = accuracy_score(y_test, y_pred)

        # baseline: ทำนาย class ที่พบบ่อยที่สุดในชุดเทรนเสมอ — เทียบว่า classifier ดีกว่า "เดามั่วๆ" แค่ไหนจริง
        majority_class = y_train.mode()[0]
        baseline_acc = accuracy_score(y_test, [majority_class] * len(y_test))

        report = classification_report(
            y_test, y_pred, labels=[0, 1, 2, 3],
            target_names=[RISK_CLASS_LABELS[c] for c in range(4)],
            output_dict=True, zero_division=0,
        )
        cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2, 3])

        print(f"   Accuracy = {acc:.4f}   (baseline เดา class ที่พบบ่อยสุดเสมอ = {baseline_acc:.4f})")
        for c in range(4):
            label = RISK_CLASS_LABELS[c]
            if c in missing_in_test:
                print(f"   {label:10s}  ไม่มีตัวอย่างในชุดทดสอบเลย — วัดผลไม่ได้ที่ horizon นี้")
            else:
                r = report[label]
                print(f"   {label:10s}  precision={r['precision']:.3f}  recall={r['recall']:.3f}  "
                      f"f1={r['f1-score']:.3f}  (n={int(r['support'])})")

        models[h] = clf
        scores[h] = {
            "accuracy": acc,
            "baseline_accuracy": baseline_acc,
            "train_class_counts": {RISK_CLASS_LABELS[c]: int(train_counts.get(c, 0)) for c in range(4)},
            "test_class_counts": {RISK_CLASS_LABELS[c]: int(test_counts.get(c, 0)) for c in range(4)},
            "classes_missing_in_train": [RISK_CLASS_LABELS[c] for c in missing_in_train],
            "classes_missing_in_test": [RISK_CLASS_LABELS[c] for c in missing_in_test],
            "per_class": {
                RISK_CLASS_LABELS[c]: {
                    "precision": report[RISK_CLASS_LABELS[c]]["precision"],
                    "recall": report[RISK_CLASS_LABELS[c]]["recall"],
                    "f1": report[RISK_CLASS_LABELS[c]]["f1-score"],
                    "support": int(report[RISK_CLASS_LABELS[c]]["support"]),
                    "measurable": c not in missing_in_test,
                } for c in range(4)
            },
            "confusion_matrix": cm.tolist(),
            "confusion_matrix_labels": [RISK_CLASS_LABELS[c] for c in range(4)],
        }
        print()

    return models, scores


def save_multi_horizon_classifier(models, scores, df):
    joblib.dump(models, CLASSIFIER_MODEL_FILE)

    meta = {
        "feature_columns": FEATURE_COLUMNS,
        "max_horizon_days": MAX_HORIZON,
        "model_type": "RandomForestClassifier (class_weight=balanced, แยกโมเดลทีละ horizon)",
        "class_labels": RISK_CLASS_LABELS,
        "class_thresholds": "0=ปกติ (DHW<1), 1=เฝ้าระวัง (1-3.9), 2=สูง (4-7.9), 3=วิกฤต (>=8)",
        "trained_at": datetime.utcnow().isoformat() + "Z",
        "training_rows_total": len(df),
        "scores_by_horizon": {str(h): s for h, s in scores.items()},
    }
    with open(CLASSIFIER_META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n💾 บันทึก classifier ไว้ที่ '{CLASSIFIER_MODEL_FILE}' (dict ของ {MAX_HORIZON} โมเดล คีย์ = จำนวนวันข้างหน้า)")
    print(f"💾 บันทึกข้อมูลประกอบไว้ที่ '{CLASSIFIER_META_FILE}' (accuracy/precision/recall/f1/confusion matrix ทุก horizon)")


# ===== MAIN =====

def main():
    raw_df = build_training_dataset()
    if raw_df is None or raw_df.empty:
        print("\n❌ ดึงข้อมูลจาก NOAA/PacIOOS ไม่สำเร็จเลยแม้แต่จุดเดียว")
        print("   ไม่สามารถเทรนโมเดลได้ในตอนนี้ — โปรดลองรันสคริปต์นี้ใหม่อีกครั้งภายหลัง")
        return

    df = engineer_features(raw_df)

    min_rows_needed = 50  # ขั้นต่ำที่พอจะ split train/test แล้วเทรนได้อย่างมีความหมาย
    if len(df) < min_rows_needed:
        print(f"\n❌ ข้อมูลที่ใช้เทรนได้จริงมีแค่ {len(df)} แถว (ต้องการอย่างน้อย {min_rows_needed} แถว)")
        print("   สาเหตุที่เป็นไปได้: ดึงข้อมูลย้อนหลังได้ไม่ครบ (server ตอบสนองบางส่วน)")
        print("   ไม่ปั้นโมเดลจากข้อมูลไม่พอ — โปรดลองรันใหม่ หรือลดจำนวนปีที่ดึง/เพิ่ม retry")
        return

    best_name, best_model, all_scores = train_and_compare(df)
    save_model(best_name, best_model, all_scores, df)

    multi_models, multi_scores = train_multi_horizon(df)
    save_multi_horizon(multi_models, multi_scores, df)

    clf_models, clf_scores = train_multi_horizon_classifier(df)
    save_multi_horizon_classifier(clf_models, clf_scores, df)

    print("\n✅ เทรนโมเดลเสร็จสมบูรณ์ (จุดเดียว +14 วันสำหรับอ้างอิง, Regressor รายวัน +1 ถึง +14 วัน, "
          "และ Classifier รายวัน +1 ถึง +14 วัน สำหรับใช้งานจริงทั้งคู่)")


if __name__ == "__main__":
    main()
