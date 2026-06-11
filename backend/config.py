"""Central config. Reads the Cohere key + model names from .env.
If no key is present, the app runs in MOCK mode so the UI is always demoable."""
import os
from dotenv import load_dotenv

load_dotenv()

COHERE_API_KEY = os.getenv("COHERE_API_KEY", "").strip()
HAS_KEY = bool(COHERE_API_KEY)

CHAT_MODEL = os.getenv("COHERE_CHAT_MODEL", "command-a-03-2025")
EMBED_MODEL = os.getenv("COHERE_EMBED_MODEL", "embed-v4.0")
RERANK_MODEL = os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5")

# How many docs to retrieve / keep after rerank
RETRIEVE_K = 8
RERANK_K = 4

ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173"]
