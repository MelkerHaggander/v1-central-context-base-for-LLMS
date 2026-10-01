import uvicorn

from boringcontext.api import create_app
from boringcontext.memory_store import InMemoryStore


def main() -> None:
    uvicorn.run(create_app(store=InMemoryStore()), host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
