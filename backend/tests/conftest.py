"""Shared fixtures — disable external sync so tests don't hit Jira/Zabbix/vCenter."""
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def app():
    with patch("app.services.sync_service.sync_all", new_callable=AsyncMock):
        from app.main import app as _app
        yield _app


@pytest.fixture
def client(app):
    with patch("app.services.sync_service.sync_all", new_callable=AsyncMock):
        with TestClient(app) as c:
            yield c
