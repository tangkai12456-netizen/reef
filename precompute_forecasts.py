"""คำนวณผลพยากรณ์ล่วงหน้าของทุกแนวปะการัง แล้วเก็บลง MongoDB

ออกแบบมาให้รันนอก Netlify (GitHub Actions หรือเครื่องเราเอง) เพราะโมเดล .pkl
รวมกันราว 450 MB — เกินขีดจำกัดของ Netlify Functions หลายเท่า
Netlify Function แค่มาอ่านผลที่คำนวณไว้แล้วจาก MongoDB ซึ่งเร็วระดับ ~100 ms

ใช้งาน:
    python precompute_forecasts.py              # คำนวณครบทุกเกาะแล้วเขียนลง DB
    python precompute_forecasts.py --dry-run    # คำนวณอย่างเดียว ไม่เขียน DB

ต้องมีใน .env: MONGODB_URI, MONGODB_DB
ต้องมีไฟล์โมเดล: dhw_models_multi.pkl, dhw_classifier_multi.pkl
    (ถ้ายังไม่มี สร้างด้วย `python train_model.py`)

ถ้าเกาะไหนพยากรณ์ไม่สำเร็จ จะ "ไม่เขียนทับของเดิม" และไม่เขียนข้อมูลปลอมลง DB
ยึดหลักเดียวกับ predict.py — ให้ frontend รู้ว่าพยากรณ์ไม่ได้ ดีกว่าโชว์ตัวเลขมั่ว
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

from train_model import REEFS

FORECAST_COLLECTION = "forecasts"


def predict_one(reef):
    """เรียก predict.py เป็น subprocess เหมือนที่ server.js ทำ

    ใช้ subprocess แทน import ตรงๆ เพื่อให้ผลลัพธ์เหมือนกับที่ /api/predict เคยคืน
    เป๊ะๆ และกันไม่ให้การโหลดโมเดล 450 MB ค้างอยู่ใน process นี้ทุกเกาะ
    """
    proc = subprocess.run(
        [sys.executable, "predict.py", str(reef["lat"]), str(reef["lon"])],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None, f"predict.py ไม่ได้คืน JSON (exit {proc.returncode}): {proc.stderr.strip()[:200]}"

    if proc.returncode != 0 or "error" in payload:
        return None, payload.get("error", f"exit code {proc.returncode}")

    return payload, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="ไม่เขียนลง MongoDB")
    args = parser.parse_args()

    load_dotenv()

    coll = None
    if not args.dry_run:
        uri = os.getenv("MONGODB_URI")
        if not uri:
            sys.exit("ไม่พบ MONGODB_URI ใน .env")
        client = MongoClient(uri, serverSelectionTimeoutMS=15000)
        client.admin.command("ping")
        coll = client[os.getenv("MONGODB_DB", "reefalert")][FORECAST_COLLECTION]

    computed_at = datetime.now(timezone.utc)
    ok, failed = 0, []

    for reef in REEFS:
        print(f"[{reef['id']}/{len(REEFS)}] {reef['name']} ...", flush=True)
        payload, err = predict_one(reef)

        if err:
            print(f"      ไม่สำเร็จ: {err}", flush=True)
            failed.append((reef["name"], err))
            continue

        doc = {
            "reef_id": reef["id"],
            "reef_name": reef["name"],
            "lat": reef["lat"],
            "lon": reef["lon"],
            "computed_at": computed_at,
            **payload,
        }

        if coll is not None:
            coll.replace_one({"_id": reef["id"]}, {"_id": reef["id"], **doc}, upsert=True)

        n = len(payload.get("forecasts", []))
        print(f"      สำเร็จ: DHW ปัจจุบัน {payload.get('current_dhw')} / พยากรณ์ {n} วัน", flush=True)
        ok += 1

    if coll is not None:
        coll.create_index([("lat", 1), ("lon", 1)])

    print()
    print(f"สรุป: สำเร็จ {ok}/{len(REEFS)} เกาะ")
    for name, err in failed:
        print(f"  ล้มเหลว: {name} — {err}")

    # ให้ CI รู้ว่ารอบนี้ไม่สมบูรณ์ แต่ของเกาะที่สำเร็จถูกบันทึกไปแล้ว
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
