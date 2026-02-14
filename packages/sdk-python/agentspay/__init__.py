"""
AgentPay Python SDK

A Python client library for the AgentPay platform - enabling AI agents to
discover, execute, and pay for services using cryptocurrency.

Example:
    >>> from agentspay import AgentPayClient
    >>> 
    >>> client = AgentPayClient(base_url="http://localhost:3100")
    >>> 
    >>> # Create wallet
    >>> wallet = client.create_wallet()
    >>> 
    >>> # Register service (provider)
    >>> service = client.register_service(
    ...     agent_id=wallet.id,
    ...     name="TextAnalyzer",
    ...     description="NLP analysis service",
    ...     price=1000,
    ...     currency="BSV",
    ...     endpoint="https://my-agent.com/analyze",
    ...     category="nlp"
    ... )
    >>> 
    >>> # Search services (consumer)
    >>> services = client.search_services(keyword="nlp")
    >>> 
    >>> # Execute service
    >>> result = client.execute(
    ...     service_id=services[0].id,
    ...     buyer_wallet_id=wallet.id,
    ...     input_data={"text": "Hello world"}
    ... )
    >>> print(result.output)
"""

from .client import AgentPayClient
from .types import (
    AgentWallet,
    Service,
    Payment,
    ExecutionResult,
    ExecutionReceipt,
    Dispute,
    Webhook,
    ReputationScore,
    ServiceQuery,
    Currency,
    PLATFORM_FEE_RATE,
    MIN_PRICE_SATOSHIS
)
from .exceptions import (
    AgentPayError,
    APIError,
    ValidationError,
    WalletError,
    ServiceError,
    PaymentError,
    DisputeError,
    WebhookError,
    ExecutionError
)

__version__ = "0.2.0"
__author__ = "AgentsPay"
__license__ = "MIT"

__all__ = [
    # Main client
    "AgentPayClient",
    
    # Types
    "AgentWallet",
    "Service",
    "Payment",
    "ExecutionResult",
    "ExecutionReceipt",
    "Dispute",
    "Webhook",
    "ReputationScore",
    "ServiceQuery",
    "Currency",
    "PLATFORM_FEE_RATE",
    "MIN_PRICE_SATOSHIS",
    
    # Exceptions
    "AgentPayError",
    "APIError",
    "ValidationError",
    "WalletError",
    "ServiceError",
    "PaymentError",
    "DisputeError",
    "WebhookError",
    "ExecutionError",
]
