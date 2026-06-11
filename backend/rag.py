"""Retrieval layer: embed → cosine retrieve → rerank. Falls back to keyword
scoring when no Cohere key is present, so the agent always returns grounded sources."""
import json
import os
import re
from functools import lru_cache

import numpy as np

import config
from connectors import Doc, docs_for
from cohere_client import get_client

_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".embed_cache.json")


def _keyword_score(query: str, text: str) -> float:
    q = set(re.findall(r"[a-z0-9]+", query.lower()))
    t = re.findall(r"[a-z0-9]+", text.lower())
    if not q or not t:
        return 0.0
    tset = set(t)
    overlap = len(q & tset)
    return overlap / len(q)


# ── Embedding cache (so we don't re-embed the corpus every request) ──────────
def _load_cache() -> dict:
    try:
        with open(_CACHE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(cache: dict) -> None:
    try:
        with open(_CACHE_PATH, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass


@lru_cache(maxsize=1)
def _corpus_embeddings() -> dict[str, list[float]]:
    """Embed every doc once (cached on disk by doc id + model)."""
    if not config.HAS_KEY:
        return {}
    from connectors import ALL_DOCS

    cache = _load_cache()
    key_prefix = config.EMBED_MODEL
    missing = [d for d in ALL_DOCS if f"{key_prefix}:{d['id']}" not in cache]
    if missing:
        co = get_client()
        resp = co.embed(
            texts=[d["text"] for d in missing],
            model=config.EMBED_MODEL,
            input_type="search_document",
            embedding_types=["float"],
        )
        vecs = resp.embeddings.float_
        for d, v in zip(missing, vecs):
            cache[f"{key_prefix}:{d['id']}"] = v
        _save_cache(cache)
    return {d["id"]: cache[f"{key_prefix}:{d['id']}"] for d in ALL_DOCS}


def retrieve(query: str, connector: str | None = None) -> list[Doc]:
    """Return the top reranked docs for a query, scoped to a connector if given."""
    pool = docs_for(connector)
    if not pool:
        return []

    if not config.HAS_KEY:
        ranked = sorted(pool, key=lambda d: _keyword_score(query, d["title"] + " " + d["text"]), reverse=True)
        return [d for d in ranked if _keyword_score(query, d["title"] + " " + d["text"]) > 0][: config.RERANK_K] or ranked[:2]

    co = get_client()
    # 1) semantic retrieve via embeddings
    emb = _corpus_embeddings()
    q = co.embed(texts=[query], model=config.EMBED_MODEL, input_type="search_query",
                 embedding_types=["float"]).embeddings.float_[0]
    qv = np.array(q)
    scored = []
    for d in pool:
        v = emb.get(d["id"])
        if v is None:
            continue
        dv = np.array(v)
        cos = float(np.dot(qv, dv) / (np.linalg.norm(qv) * np.linalg.norm(dv) + 1e-9))
        scored.append((cos, d))
    scored.sort(key=lambda x: x[0], reverse=True)
    candidates = [d for _, d in scored[: config.RETRIEVE_K]] or pool[: config.RETRIEVE_K]

    # 2) rerank for precision
    try:
        rr = co.rerank(
            query=query,
            documents=[d["title"] + ". " + d["text"] for d in candidates],
            model=config.RERANK_MODEL,
            top_n=config.RERANK_K,
        )
        return [candidates[r.index] for r in rr.results]
    except Exception:
        return candidates[: config.RERANK_K]
