"""Payment and execution operations for AgentPay SDK"""

from typing import Optional, Dict, Any
import requests
from .types import ExecutionResult, ExecutionReceipt, Payment
from .exceptions import PaymentError, ExecutionError


class PaymentOperations:
    """Handles payment and service execution"""
    
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url
        self.api_key = api_key
    
    def _get_headers(self) -> dict:
        """Get request headers with API key if available"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["x-api-key"] = self.api_key
        return headers
    
    def execute(
        self,
        service_id: str,
        buyer_wallet_id: str,
        input_data: Dict[str, Any]
    ) -> ExecutionResult:
        """
        Execute a service and handle payment
        
        Args:
            service_id: Service ID to execute
            buyer_wallet_id: Buyer's wallet ID
            input_data: Input data for the service
            
        Returns:
            ExecutionResult: Execution result with payment and receipt
            
        Raises:
            ExecutionError: If execution fails
        """
        payload = {
            "buyerWalletId": buyer_wallet_id,
            "input": input_data
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/api/execute/{service_id}",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            # Parse receipt if available
            receipt = None
            if "receipt" in data and data["receipt"]:
                receipt = self._parse_receipt(data["receipt"])
            
            # Parse payment if available
            payment = None
            if "payment" in data and data["payment"]:
                payment = self._parse_payment(data["payment"])
            
            return ExecutionResult(
                payment_id=data["paymentId"],
                service_id=data.get("serviceId", service_id),
                output=data.get("output", {}),
                execution_time_ms=data.get("executionTimeMs", 0),
                status=data.get("status", "pending"),
                receipt=receipt,
                payment=payment
            )
        except requests.RequestException as e:
            raise ExecutionError(f"Service execution failed: {str(e)}") from e
    
    def get_payment(self, payment_id: str) -> Payment:
        """
        Get payment by ID
        
        Args:
            payment_id: Payment ID
            
        Returns:
            Payment: The payment record
            
        Raises:
            PaymentError: If payment not found or request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/payments/{payment_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            payment_data = data.get("payment")
            if not payment_data:
                raise PaymentError(f"Payment {payment_id} not found")
            
            return self._parse_payment(payment_data)
        except requests.RequestException as e:
            raise PaymentError(f"Failed to get payment: {str(e)}") from e
    
    def get_receipt(self, receipt_id: str) -> ExecutionReceipt:
        """
        Get execution receipt by ID
        
        Args:
            receipt_id: Receipt ID
            
        Returns:
            ExecutionReceipt: The execution receipt
            
        Raises:
            PaymentError: If receipt not found or request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/receipts/{receipt_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            receipt_data = data.get("receipt")
            if not receipt_data:
                raise PaymentError(f"Receipt {receipt_id} not found")
            
            return self._parse_receipt(receipt_data)
        except requests.RequestException as e:
            raise PaymentError(f"Failed to get receipt: {str(e)}") from e
    
    def _parse_payment(self, data: dict) -> Payment:
        """Parse payment data from API response"""
        return Payment(
            id=data["id"],
            service_id=data["serviceId"],
            buyer_wallet_id=data["buyerWalletId"],
            seller_wallet_id=data["sellerWalletId"],
            amount=data["amount"],
            platform_fee=data["platformFee"],
            currency=data["currency"],
            status=data["status"],
            created_at=data["createdAt"],
            dispute_status=data.get("disputeStatus"),
            tx_id=data.get("txId"),
            completed_at=data.get("completedAt")
        )
    
    def _parse_receipt(self, data: dict) -> ExecutionReceipt:
        """Parse receipt data from API response"""
        return ExecutionReceipt(
            id=data["id"],
            payment_id=data["paymentId"],
            service_id=data["serviceId"],
            input_hash=data["inputHash"],
            output_hash=data["outputHash"],
            timestamp=data["timestamp"],
            execution_time_ms=data["executionTimeMs"],
            provider_signature=data["providerSignature"],
            platform_signature=data["platformSignature"],
            receipt_hash=data["receiptHash"],
            blockchain_tx_id=data.get("blockchainTxId"),
            blockchain_anchored_at=data.get("blockchainAnchoredAt")
        )
