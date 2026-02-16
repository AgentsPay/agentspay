"""Live smoke test for AgentPay Python SDK against a running API."""

import os
import sys
import time
from pathlib import Path

import requests

# Allow running this script directly from the repo without installing the package.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agentspay import AgentPayClient


def wait_for_api(base_url: str, timeout_seconds: int = 30) -> None:
    deadline = time.time() + timeout_seconds
    health_url = f"{base_url.rstrip('/')}/api/health"
    last_error = None
    while time.time() < deadline:
        try:
            resp = requests.get(health_url, timeout=2)
            if resp.status_code == 200:
                return
            last_error = f"health status {resp.status_code}"
        except Exception as exc:  # pragma: no cover - smoke script
            last_error = str(exc)
        time.sleep(1)
    raise RuntimeError(f"API not ready at {health_url}: {last_error}")


def main() -> int:
    base_url = os.getenv("AGENTPAY_API_URL", "http://localhost:3100").rstrip("/")
    wait_for_api(base_url)

    client = AgentPayClient(base_url=base_url)

    wallet = client.create_wallet()
    assert wallet.id, "wallet.id is empty"
    assert wallet.api_key, "wallet.api_key missing"
    assert client.api_key == wallet.api_key, "client api_key was not propagated"

    same_wallet = client.get_wallet(wallet.id)
    assert same_wallet.id == wallet.id, "get_wallet returned different wallet id"

    service = client.register_service(
        agent_id=wallet.id,
        name="SmokeService",
        description="Smoke test service",
        price=1,
        currency="BSV",
        endpoint="https://example.com/smoke",
        category="test",
    )
    assert service.id, "service.id is empty"

    webhook = client.register_webhook(
        url="https://example.com/webhook",
        events=["payment.completed"],
    )
    assert webhook.id, "webhook.id is empty"

    fetched_webhook = client.get_webhook(webhook.id)
    assert fetched_webhook.id == webhook.id, "get_webhook failed"

    updated_webhook = client.update_webhook(webhook.id, active=False)
    assert updated_webhook.id == webhook.id, "update_webhook failed"

    disputes = client.get_payment_disputes("payment_does_not_exist")
    assert isinstance(disputes, list), "get_payment_disputes did not return a list"

    print("live_smoke_ok", wallet.id, service.id, webhook.id)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"live_smoke_failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
