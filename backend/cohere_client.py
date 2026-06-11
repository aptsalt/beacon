"""Lazy Cohere v2 client. Kept tiny and server-side only — the API key never
reaches the browser (a hard requirement for a security-first product like North)."""
from functools import lru_cache

import config


@lru_cache(maxsize=1)
def get_client():
    import cohere
    return cohere.ClientV2(api_key=config.COHERE_API_KEY)
