"""Vercel FastAPI entry. The platform imports the `app` object from this file."""

from boringcontext.runtime import create_runtime_app

app = create_runtime_app()
