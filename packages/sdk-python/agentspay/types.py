"""AgentPay SDK Type Definitions"""

from dataclasses import dataclass, field
from typing import Optional, Literal, Dict, Any
from datetime import datetime


Currency = Literal["BSV", "MNEE"]
PaymentStatus = Literal["pending", "escrowed", "released", "disputed", "refunded"]
DisputeStatus = Literal["open", "under_review", "resolved_refund", "resolved_release", "resolved_split", "expired"]
DisputeResolution = Literal["refund", "release", "split"]
ExecutionStatus = Literal["success", "error"]
HttpMethod = Literal["POST", "GET"]


@dataclass
class AgentWallet:
    """Agent wallet representation"""
    id: str
    public_key: str
    address: str
    created_at: str
    balance: Optional[int] = None  # satoshis (BSV)
    balance_mnee: Optional[int] = None  # cents (MNEE)


@dataclass
class Service:
    """Service registration"""
    id: str
    agent_id: str
    name: str
    description: str
    category: str
    price: int  # satoshis for BSV, cents for MNEE
    currency: Currency
    endpoint: str
    method: HttpMethod
    active: bool
    timeout: int  # seconds
    dispute_window: int  # minutes
    created_at: str
    updated_at: str
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None


@dataclass
class Payment:
    """Payment record"""
    id: str
    service_id: str
    buyer_wallet_id: str
    seller_wallet_id: str
    amount: int
    platform_fee: int
    currency: Currency
    status: PaymentStatus
    created_at: str
    dispute_status: Optional[str] = None
    tx_id: Optional[str] = None
    completed_at: Optional[str] = None


@dataclass
class ExecutionRequest:
    """Service execution request"""
    service_id: str
    buyer_wallet_id: str
    input: Dict[str, Any]


@dataclass
class ExecutionResult:
    """Service execution result"""
    payment_id: str
    service_id: str
    output: Dict[str, Any]
    execution_time_ms: int
    status: ExecutionStatus
    receipt: Optional['ExecutionReceipt'] = None
    payment: Optional[Payment] = None


@dataclass
class ExecutionReceipt:
    """Cryptographic execution receipt"""
    id: str
    payment_id: str
    service_id: str
    input_hash: str
    output_hash: str
    timestamp: int
    execution_time_ms: int
    provider_signature: str
    platform_signature: str
    receipt_hash: str
    blockchain_tx_id: Optional[str] = None
    blockchain_anchored_at: Optional[str] = None


@dataclass
class ReputationScore:
    """Agent reputation metrics"""
    agent_id: str
    total_jobs: int
    success_rate: float  # 0-1
    avg_response_time_ms: float
    total_earned: int  # satoshis
    total_spent: int  # satoshis
    rating: float  # 1-5


@dataclass
class Dispute:
    """Dispute record"""
    id: str
    payment_id: str
    buyer_wallet_id: str
    provider_wallet_id: str
    reason: str
    status: DisputeStatus
    created_at: str
    evidence: Optional[str] = None
    resolution: Optional[DisputeResolution] = None
    split_percent: Optional[float] = None
    resolved_at: Optional[str] = None


@dataclass
class Webhook:
    """Webhook registration"""
    id: str
    url: str
    events: list[str]
    active: bool
    created_at: str
    secret: Optional[str] = None


@dataclass
class ServiceQuery:
    """Service search query"""
    category: Optional[str] = None
    keyword: Optional[str] = None
    max_price: Optional[int] = None
    min_rating: Optional[float] = None
    limit: Optional[int] = 20
    offset: Optional[int] = 0


# Constants
PLATFORM_FEE_RATE = 0.02  # 2%
MIN_PRICE_SATOSHIS = 1
