#!/usr/bin/env python3
import argparse
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path


SQLITE_TABLES = [
    "reader_accounts",
    "reader_articles",
    "cache_html",
    "cache_comment",
    "cache_resource",
    "cache_metadata",
    "cache_resource_map",
    "cache_asset",
    "cache_comment_reply",
    "cache_debug",
    "scheduler_state",
    "scheduler_articles",
]


def backup_file(path: Path) -> Path:
    backup = path.with_name(f"{path.stem}.before-authkey-migrate-{time.strftime('%Y%m%d-%H%M%S')}{path.suffix}")
    shutil.copy2(path, backup)
    return backup


def merge_dir(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            merge_dir(item, target)
            continue
        if not target.exists():
            shutil.move(str(item), str(target))
            continue
        backup = target.with_name(f"{target.name}.old-{int(time.time())}")
        shutil.move(str(item), str(backup))
    try:
        src.rmdir()
    except OSError:
        pass


def table_exists(cur: sqlite3.Cursor, table: str) -> bool:
    row = cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return bool(row)


def count_rows_by_auth(cur: sqlite3.Cursor, table: str, auth_key: str) -> int:
    return int(cur.execute(f"SELECT COUNT(*) FROM {table} WHERE auth_key=?", (auth_key,)).fetchone()[0])


def migrate_sqlite(db_path: Path, old_key: str, new_key: str) -> None:
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    print("[sqlite before]")
    for table in SQLITE_TABLES:
        if not table_exists(cur, table):
          continue
        old_count = count_rows_by_auth(cur, table, old_key)
        new_count = count_rows_by_auth(cur, table, new_key)
        print(f"{table}: old={old_count}, new={new_count}")

    conn.execute("BEGIN IMMEDIATE")
    try:
        for table in SQLITE_TABLES:
            if not table_exists(cur, table):
                continue
            cur.execute(f"DELETE FROM {table} WHERE auth_key=?", (new_key,))
            cur.execute(f"UPDATE {table} SET auth_key=? WHERE auth_key=?", (new_key, old_key))
        conn.commit()
        print("\nsqlite auth_key migrated")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    print("\n[sqlite after]")
    for table in ["reader_accounts", "reader_articles", "scheduler_state", "scheduler_articles"]:
        if not table_exists(cur, table):
            continue
        count = count_rows_by_auth(cur, table, new_key)
        print(f"{table}: new={count}")
    conn.close()


def migrate_scheduler_kv(kv_dir: Path, old_key: str, new_key: str) -> None:
    print("\n[kv migrate]")

    state_dir = kv_dir / "scheduler" / "state"
    old_state = state_dir / old_key
    new_state = state_dir / new_key
    if old_state.exists():
        state_dir.mkdir(parents=True, exist_ok=True)
        if new_state.exists():
            backup = state_dir / f"{old_key}.bak-{int(time.time())}"
            shutil.move(str(old_state), str(backup))
            print("scheduler state old kept as backup:", backup)
        else:
            shutil.move(str(old_state), str(new_state))
            print("scheduler state moved:", old_state, "->", new_state)

    articles_dir = kv_dir / "scheduler" / "articles"
    old_articles = articles_dir / old_key
    new_articles = articles_dir / new_key
    if old_articles.exists():
        articles_dir.mkdir(parents=True, exist_ok=True)
        if new_articles.exists():
            merge_dir(old_articles, new_articles)
            print("scheduler articles merged into:", new_articles)
        else:
            shutil.move(str(old_articles), str(new_articles))
            print("scheduler articles moved:", old_articles, "->", new_articles)

    index_file = kv_dir / "scheduler" / "index"
    if index_file.exists():
        raw = index_file.read_text(encoding="utf-8", errors="ignore").strip()
        try:
            value = json.loads(raw) if raw else []
            if isinstance(value, list):
                value = [new_key if item == old_key else item for item in value]
                deduped = []
                for item in value:
                    if item and item not in deduped:
                        deduped.append(item)
                index_file.write_text(json.dumps(deduped, ensure_ascii=False), encoding="utf-8")
                print("scheduler index updated")
        except Exception as exc:
            print("scheduler index skip:", exc)


def preserve_new_cookie(kv_dir: Path, old_key: str, new_key: str) -> None:
    cookie_dir = kv_dir / "cookie"
    old_cookie = cookie_dir / old_key
    new_cookie = cookie_dir / new_key
    if not old_cookie.exists():
        return
    cookie_dir.mkdir(parents=True, exist_ok=True)
    if new_cookie.exists():
        backup = cookie_dir / f"{old_key}.bak-{int(time.time())}"
        shutil.move(str(old_cookie), str(backup))
        print("legacy cookie kept as backup:", backup)
        return
    shutil.move(str(old_cookie), str(new_cookie))
    print("legacy cookie moved:", old_cookie, "->", new_cookie)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate project data from one auth_key to another.")
    parser.add_argument("--base-dir", default="/vol1/1000/wxrss/docker-data", help="docker-data directory path")
    parser.add_argument("--old-key", required=True, help="old auth_key")
    parser.add_argument("--new-key", required=True, help="new auth_key")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_dir = Path(args.base_dir)
    db_path = base_dir / "sqlite" / "app.db"
    kv_dir = base_dir / "kv"

    if not db_path.exists():
        print(f"sqlite db not found: {db_path}", file=sys.stderr)
        return 1

    backup = backup_file(db_path)
    print("backup db:", backup)

    migrate_sqlite(db_path, args.old_key, args.new_key)
    migrate_scheduler_kv(kv_dir, args.old_key, args.new_key)
    preserve_new_cookie(kv_dir, args.old_key, args.new_key)

    print("\nmigration done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
