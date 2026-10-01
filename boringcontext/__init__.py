"""BoringContext v1.2 memory brain.

MCP exposes get_context and save_memory. Personal is the default space unless
the text explicitly asks for shared.
"""

from boringcontext.brain import DIRECT_SIMILARITY, NEIGHBOR_SIMILARITY, cosine_similarity
from boringcontext.clock import to_iso
from boringcontext.memory_store import InMemoryStore, content_fingerprint
from boringcontext.store import (
    CONTEXT_ITEM_LIMIT,
    CONTEXT_JSON_LIMIT,
    CONTEXT_SNIPPET_LIMIT,
    PAGE_SIZE,
    clean_search_query,
    create_memory_api,
    extract_keywords,
)
from boringcontext.supabase_store import SupabaseStore, vector_literal
from boringcontext.validate import validate_memory_id, validate_memory_input, validate_search_input

__all__ = [
    "CONTEXT_ITEM_LIMIT",
    "CONTEXT_JSON_LIMIT",
    "CONTEXT_SNIPPET_LIMIT",
    "DIRECT_SIMILARITY",
    "InMemoryStore",
    "NEIGHBOR_SIMILARITY",
    "PAGE_SIZE",
    "SupabaseStore",
    "clean_search_query",
    "content_fingerprint",
    "cosine_similarity",
    "create_memory_api",
    "extract_keywords",
    "to_iso",
    "validate_memory_id",
    "validate_memory_input",
    "validate_search_input",
    "vector_literal",
]
