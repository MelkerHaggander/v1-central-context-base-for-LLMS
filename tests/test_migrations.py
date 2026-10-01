import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_identity_migration_merges_before_the_unique_index():
    migration = (ROOT / "supabase/migrations/20260921200000_merge_memory_identity_duplicates.sql").read_text()
    assert re.search(r"partition by user_id, project, category, title", migration, re.I)
    assert re.search(r"merge into public\.memories", migration, re.I)
    assert not re.search(r"delete from public\.memories", migration, re.I)
    assert re.search(r"unique index if not exists memories_identity_idx[\s\S]*user_id, project, category, title", migration, re.I)


def test_v12_brain_migration_adds_vectors_without_deleting_rows():
    migration = (ROOT / "supabase/migrations/20260926120000_v12_brain_vectors.sql").read_text()
    assert re.search(r"create extension if not exists vector", migration, re.I)
    assert re.search(r"create table if not exists public\.spaces", migration, re.I)
    assert re.search(r"embedding vector\(3072\)", migration, re.I)
    assert re.search(r"halfvec_cosine_ops", migration, re.I)
    assert not re.search(r"hnsw \(embedding vector_cosine_ops\)", migration, re.I)
    version_table = re.search(r"create table if not exists public\.memory_versions \([\s\S]*?\);", migration, re.I)
    assert version_table
    body = version_table.group(0)
    assert not re.search(r"embedding", body, re.I)
    assert not re.search(r"on delete cascade", body, re.I)
    assert not re.search(r"references public\.memories", body, re.I)
    assert re.search(r"event in \('update', 'delete'\)", body, re.I)
    assert not re.search(r"delete from", migration, re.I)
