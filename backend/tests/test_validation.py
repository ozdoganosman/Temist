"""Tests for validation, cache clearing, and scan result endpoints."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_ml_train_requires_min_bars():
    """ML training should reject data with fewer than 100 bars."""
    response = client.post("/api/ml/train", json={
        "ohlcv": [
            {"date": "2024-01-01", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 100}
        ] * 50
    })
    assert response.status_code == 422


def test_scan_results_empty_initially():
    """Scan results should return empty when no scan has been done."""
    # Clear any existing cache first
    client.delete("/api/scan/cache")
    response = client.get("/api/scan/results")
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert data["results"] == []


def test_clear_scan_cache():
    """Clearing scan cache should succeed."""
    response = client.delete("/api/scan/cache")
    assert response.status_code == 200
    data = response.json()
    assert data["cleared"] is True


def test_clear_ml_cache():
    """Clearing ML cache should succeed."""
    response = client.delete("/api/ml/cache")
    assert response.status_code == 200
    data = response.json()
    assert data["cleared"] is True


def test_clear_financials_cache():
    """Clearing financials cache should succeed."""
    response = client.delete("/api/financials/cache")
    assert response.status_code == 200
    data = response.json()
    assert "cleared" in data


def test_health_check():
    """Health check endpoint should return 200 OK."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
