"""นำเข้าข้อมูล DHW จากไฟล์ Excel/CSV เข้า MongoDB

ใช้งาน:
    python import_to_mongo.py                          # นำเข้า dhw_training_data.xlsx
    python import_to_mongo.py --file other.csv         # ระบุไฟล์เอง
    python import_to_mongo.py --drop                   # ล้าง collection เดิมก่อนนำเข้า
    python import_to_mongo.py --dry-run                # ดูตัวอย่างเอกสารโดยไม่เขียนจริง

ต้องตั้งค่าใน .env:
    MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
    MONGODB_DB=reefalert
    MONGODB_COLLECTION=dhw_records
"""
import argparse
import os
import sys

import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient, ASCENDING

BATCH_SIZE = 5000


def load_dataframe(path):
    if path.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path)

    # time ในไฟล์เป็น string -> แปลงเป็น datetime เพื่อให้ query ช่วงเวลาใน MongoDB ได้
    if "time" in df.columns:
        df["time"] = pd.to_datetime(df["time"], errors="coerce", utc=True)

    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="dhw_training_data.xlsx")
    parser.add_argument("--drop", action="store_true", help="ลบ collection เดิมก่อนนำเข้า")
    parser.add_argument("--dry-run", action="store_true", help="แสดงตัวอย่างโดยไม่เขียน DB")
    args = parser.parse_args()

    load_dotenv()

    df = load_dataframe(args.file)
    print(f"อ่าน {args.file}: {len(df):,} แถว {len(df.columns)} คอลัมน์")

    records = df.to_dict(orient="records")

    if args.dry_run:
        print("ตัวอย่างเอกสารแรก:")
        for key, value in records[0].items():
            print(f"  {key}: {value!r}")
        return

    uri = os.getenv("MONGODB_URI")
    if not uri:
        sys.exit("ไม่พบ MONGODB_URI ใน .env")

    db_name = os.getenv("MONGODB_DB", "reefalert")
    coll_name = os.getenv("MONGODB_COLLECTION", "dhw_records")

    client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    coll = client[db_name][coll_name]

    if args.drop:
        coll.drop()
        print(f"ลบ collection {db_name}.{coll_name} เดิมแล้ว")

    inserted = 0
    for start in range(0, len(records), BATCH_SIZE):
        batch = records[start:start + BATCH_SIZE]
        coll.insert_many(batch, ordered=False)
        inserted += len(batch)
        print(f"  เขียนแล้ว {inserted:,}/{len(records):,}")

    # index สำหรับ query ตามแนวปะการังและช่วงเวลา
    coll.create_index([("reef_id", ASCENDING), ("time", ASCENDING)])
    coll.create_index([("time", ASCENDING)])

    print(f"เสร็จสิ้น: {coll.count_documents({}):,} เอกสารใน {db_name}.{coll_name}")
    client.close()


if __name__ == "__main__":
    main()
