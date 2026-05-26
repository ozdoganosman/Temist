"""WebSocket streaming endpoint for real-time symbol data."""
import asyncio
import json
from datetime import datetime

import borsapy as bp
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import WS_TIMEOUT
from log import get_logger
from shared import active_connections, _connections_lock, stream_tasks

logger = get_logger(__name__)
router = APIRouter(tags=["websocket"])

_tv_stream = None
_tv_stream_lock = asyncio.Lock()


async def _get_shared_stream():
    """Get or create a shared TradingViewStream instance."""
    global _tv_stream
    async with _tv_stream_lock:
        if _tv_stream is None or not _tv_stream.is_connected:
            _tv_stream = bp.create_stream()
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: _tv_stream.connect(timeout=10))
            logger.info("TradingView stream connected")
        return _tv_stream


async def stream_symbol_data(symbol: str):
    """Background task that streams realtime data for a symbol via borsapy."""
    try:
        loop = asyncio.get_running_loop()
        stream = await _get_shared_stream()

        def on_quote_cb(sym, quote):
            """Callback when new quote arrives from TradingView stream."""
            with _connections_lock:
                conns = list(active_connections.get(symbol, set()))
            if not conns:
                return

            price = quote.get("last") or 0
            msg = json.dumps({
                "type": "quote",
                "symbol": symbol,
                "data": {
                    "price": price,
                    "change": quote.get("change") or 0,
                    "changePercent": quote.get("change_percent") or 0,
                    "volume": quote.get("volume") or 0,
                    "high": quote.get("high") or 0,
                    "low": quote.get("low") or 0,
                    "open": quote.get("open") or 0,
                    "time": datetime.now().isoformat(),
                },
            })

            # Schedule sending from the callback thread into the asyncio loop
            for ws in conns:
                loop.call_soon_threadsafe(asyncio.ensure_future, safe_send(ws, msg, symbol))

        stream.on_quote(symbol, on_quote_cb)
        stream.subscribe(symbol)
        logger.info("Subscribed to quotes: %s", symbol)

        # Keep the task running
        while True:
            await asyncio.sleep(1)

    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error("Stream error for %s: %s", symbol, e, exc_info=True)


async def safe_send(ws: WebSocket, msg: str, symbol: str):
    try:
        await ws.send_text(msg)
    except Exception:
        with _connections_lock:
            active_connections.get(symbol, set()).discard(ws)


@router.websocket("/ws/stream/{symbol}")
async def websocket_stream(websocket: WebSocket, symbol: str):
    await websocket.accept()

    with _connections_lock:
        if symbol not in active_connections:
            active_connections[symbol] = set()
        active_connections[symbol].add(websocket)

    # Start stream task if not already running
    if symbol not in stream_tasks or stream_tasks[symbol].done():
        stream_tasks[symbol] = asyncio.create_task(stream_symbol_data(symbol))

    try:
        # Send initial quote data
        try:
            t = bp.Ticker(symbol)
            loop = asyncio.get_running_loop()
            h = await loop.run_in_executor(None, lambda: t.history(period="1d", interval="1m"))
            if h is not None and not h.empty:
                last = h.iloc[-1]
                first = h.iloc[0]
                await websocket.send_text(json.dumps({
                    "type": "snapshot",
                    "symbol": symbol,
                    "data": {
                        "price": round(float(last["Close"]), 2),
                        "open": round(float(first["Open"]), 2),
                        "high": round(float(h["High"].max()), 2),
                        "low": round(float(h["Low"].min()), 2),
                        "volume": int(h["Volume"].sum()) if h["Volume"].sum() == h["Volume"].sum() else 0,
                        "time": datetime.now().isoformat(),
                    },
                }))
        except Exception as snap_err:
            try:
                await websocket.send_text(json.dumps({"type": "error", "message": f"Snapshot failed: {snap_err}"}))
            except Exception:
                pass

        # Keep connection alive
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=WS_TIMEOUT)
                if msg == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "heartbeat"}))

    except WebSocketDisconnect:
        pass
    finally:
        with _connections_lock:
            active_connections.get(symbol, set()).discard(websocket)
            remaining = len(active_connections.get(symbol, set()))
        # If no more connections for this symbol, cancel the stream and unsubscribe
        if remaining == 0:
            task = stream_tasks.pop(symbol, None)
            if task:
                task.cancel()
            with _connections_lock:
                active_connections.pop(symbol, None)
            # Unsubscribe from the shared stream to stop receiving data
            if _tv_stream is not None:
                try:
                    _tv_stream.unsubscribe(symbol)
                except Exception:
                    pass
