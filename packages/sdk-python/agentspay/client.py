"""AgentPay SDK Main Client"""

from typing import Optional, List, Dict, Any
from .wallet import WalletOperations
from .services import ServiceOperations
from .payments import PaymentOperations
from .disputes import DisputeOperations
from .webhooks import WebhookOperations
from .types import (
    AgentWallet,
    Service,
    ExecutionResult,
    Payment,
    Dispute,
    Webhook,
    ReputationScore
)
from .exceptions import AgentPayError
import requests


class AgentPayClient:
    """
    AgentPay SDK Client
    
    Main interface for interacting with AgentPay platform.
    
    Example:
        >>> client = AgentPayClient(base_url="http://localhost:3100", api_key="your-key")
        >>> wallet = client.create_wallet()
        >>> service = client.register_service(
        ...     agent_id=wallet.id,
        ...     name="TextAnalyzer",
        ...     description="NLP analysis",
        ...     price=1000,
        ...     currency="BSV",
        ...     endpoint="https://my-agent.com/analyze",
        ...     category="nlp"
        ... )
    """
    
    def __init__(
        self,
        base_url: str = "http://localhost:3100",
        api_key: Optional[str] = None
    ):
        """
        Initialize AgentPay client
        
        Args:
            base_url: AgentPay API base URL
            api_key: Optional API key for authentication
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        
        # Initialize operation modules
        self._wallet = WalletOperations(self.base_url, self.api_key)
        self._services = ServiceOperations(self.base_url, self.api_key)
        self._payments = PaymentOperations(self.base_url, self.api_key)
        self._disputes = DisputeOperations(self.base_url, self.api_key)
        self._webhooks = WebhookOperations(self.base_url, self.api_key)
    
    # Wallet Operations
    
    def create_wallet(self) -> AgentWallet:
        """Create a new agent wallet"""
        return self._wallet.create_wallet()
    
    def get_wallet(self, wallet_id: str) -> AgentWallet:
        """Get wallet by ID"""
        return self._wallet.get_wallet(wallet_id)
    
    def get_balance(self, wallet_id: str, currency: str = "BSV") -> int:
        """Get wallet balance for a specific currency"""
        return self._wallet.get_balance(wallet_id, currency)
    
    # Service Operations
    
    def register_service(
        self,
        agent_id: str,
        name: str,
        description: str,
        price: int,
        endpoint: str,
        category: str = "general",
        currency: str = "BSV",
        method: str = "POST",
        timeout: int = 30,
        dispute_window: int = 30,
        input_schema: Optional[dict] = None,
        output_schema: Optional[dict] = None
    ) -> Service:
        """Register a new service"""
        return self._services.register_service(
            agent_id=agent_id,
            name=name,
            description=description,
            price=price,
            endpoint=endpoint,
            category=category,
            currency=currency,
            method=method,
            timeout=timeout,
            dispute_window=dispute_window,
            input_schema=input_schema,
            output_schema=output_schema
        )
    
    def search_services(
        self,
        keyword: Optional[str] = None,
        category: Optional[str] = None,
        max_price: Optional[int] = None,
        min_rating: Optional[float] = None,
        limit: int = 20,
        offset: int = 0
    ) -> List[Service]:
        """Search for services"""
        return self._services.search_services(
            keyword=keyword,
            category=category,
            max_price=max_price,
            min_rating=min_rating,
            limit=limit,
            offset=offset
        )
    
    def get_service(self, service_id: str) -> Service:
        """Get service by ID"""
        return self._services.get_service(service_id)
    
    # Payment & Execution Operations
    
    def execute(
        self,
        service_id: str,
        buyer_wallet_id: str,
        input_data: Dict[str, Any]
    ) -> ExecutionResult:
        """
        Execute a service and handle payment
        
        Returns execution result with payment details and cryptographic receipt
        """
        return self._payments.execute(service_id, buyer_wallet_id, input_data)
    
    def get_payment(self, payment_id: str) -> Payment:
        """Get payment by ID"""
        return self._payments.get_payment(payment_id)
    
    def get_receipt(self, receipt_id: str):
        """Get execution receipt by ID"""
        return self._payments.get_receipt(receipt_id)
    
    # Dispute Operations
    
    def open_dispute(
        self,
        payment_id: str,
        reason: str,
        evidence: Optional[str] = None
    ) -> Dispute:
        """Open a dispute for a payment"""
        return self._disputes.open_dispute(payment_id, reason, evidence)
    
    def get_dispute(self, dispute_id: str) -> Dispute:
        """Get dispute by ID"""
        return self._disputes.get_dispute(dispute_id)
    
    def get_payment_disputes(self, payment_id: str) -> List[Dispute]:
        """Get all disputes for a payment"""
        return self._disputes.get_payment_disputes(payment_id)
    
    def add_dispute_evidence(self, dispute_id: str, evidence: str) -> Dispute:
        """Add evidence to a dispute"""
        return self._disputes.add_evidence(dispute_id, evidence)
    
    # Webhook Operations
    
    def register_webhook(
        self,
        url: str,
        events: List[str]
    ) -> Webhook:
        """
        Register a webhook
        
        Args:
            url: Webhook endpoint URL
            events: Events to subscribe to (e.g., ["payment.completed", "payment.failed"])
        """
        return self._webhooks.register_webhook(url, events)
    
    def get_webhook(self, webhook_id: str) -> Webhook:
        """Get webhook by ID"""
        return self._webhooks.get_webhook(webhook_id)
    
    def list_webhooks(self) -> List[Webhook]:
        """List all registered webhooks"""
        return self._webhooks.list_webhooks()
    
    def delete_webhook(self, webhook_id: str) -> bool:
        """Delete a webhook"""
        return self._webhooks.delete_webhook(webhook_id)
    
    def update_webhook(
        self,
        webhook_id: str,
        url: Optional[str] = None,
        events: Optional[List[str]] = None,
        active: Optional[bool] = None
    ) -> Webhook:
        """Update a webhook"""
        return self._webhooks.update_webhook(webhook_id, url, events, active)
    
    # Reputation Operations
    
    def get_reputation(self, agent_id: str) -> ReputationScore:
        """
        Get reputation score for an agent
        
        Args:
            agent_id: Agent wallet ID
            
        Returns:
            ReputationScore: Agent's reputation metrics
        """
        try:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            response = requests.get(
                f"{self.base_url}/api/agents/{agent_id}/reputation",
                headers=headers
            )
            response.raise_for_status()
            data = response.json()
            
            rep_data = data.get("reputation")
            if not rep_data:
                raise AgentPayError(f"Reputation for agent {agent_id} not found")
            
            return ReputationScore(
                agent_id=rep_data["agentId"],
                total_jobs=rep_data["totalJobs"],
                success_rate=rep_data["successRate"],
                avg_response_time_ms=rep_data["avgResponseTimeMs"],
                total_earned=rep_data["totalEarned"],
                total_spent=rep_data["totalSpent"],
                rating=rep_data["rating"]
            )
        except requests.RequestException as e:
            raise AgentPayError(f"Failed to get reputation: {str(e)}") from e
