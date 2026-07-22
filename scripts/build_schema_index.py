#!/usr/bin/env python3
"""Build the FAISS schema catalog index from metadata.json."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "secrets.env")

from copilot_utils import get_embedding
from schema_catalog import get_schema_catalog


def main():
    catalog = get_schema_catalog()
    count = catalog.build(get_embedding)
    print(f"Built schema catalog with {count} entries.")
    print(f"Index: data/schema_catalog.faiss")
    print(f"Sidecar: data/schema_catalog.json")


if __name__ == "__main__":
    main()
