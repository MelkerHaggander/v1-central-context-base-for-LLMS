import uvicorn

from boringcontext.runtime import create_runtime_app


def main() -> None:
    uvicorn.run(create_runtime_app(), host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
