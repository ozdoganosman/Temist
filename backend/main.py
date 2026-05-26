"""Borsa API -- FastAPI application factory."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS, HOST, PORT
from log import setup_logging, get_logger

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    from shared import stream_tasks
    for task in stream_tasks.values():
        task.cancel()


app = FastAPI(title="Borsa API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


from routers import symbols, history, financials, scan, ml, ws

app.include_router(symbols.router)
app.include_router(history.router)
app.include_router(financials.router)
app.include_router(scan.router)
app.include_router(ml.router)
app.include_router(ws.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
