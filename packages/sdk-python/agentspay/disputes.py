"""Dispute management for AgentPay SDK"""

from typing import Optional, List
import requests
from .types import Dispute
from .exceptions import DisputeError


class DisputeOperations:
    """Handles dispute operations"""
    
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
    
    def open_dispute(
        self,
        payment_id: str,
        reason: str,
        evidence: Optional[str] = None
    ) -> Dispute:
        """
        Open a dispute for a payment
        
        Args:
            payment_id: Payment ID to dispute
            reason: Reason for the dispute
            evidence: Optional evidence (URL, description, etc.)
            
        Returns:
            Dispute: The created dispute
            
        Raises:
            DisputeError: If dispute creation fails
        """
        payload = {
            "paymentId": payment_id,
            "reason": reason
        }
        
        if evidence:
            payload["evidence"] = evidence
        
        try:
            response = requests.post(
                f"{self.base_url}/api/disputes",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            dispute_data = data.get("dispute")
            if not dispute_data:
                raise DisputeError("Invalid response: missing dispute data")
            
            return self._parse_dispute(dispute_data)
        except requests.RequestException as e:
            raise DisputeError(f"Failed to open dispute: {str(e)}") from e
    
    def get_dispute(self, dispute_id: str) -> Dispute:
        """
        Get dispute by ID
        
        Args:
            dispute_id: Dispute ID
            
        Returns:
            Dispute: The dispute
            
        Raises:
            DisputeError: If dispute not found or request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/disputes/{dispute_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            dispute_data = data.get("dispute")
            if not dispute_data:
                raise DisputeError(f"Dispute {dispute_id} not found")
            
            return self._parse_dispute(dispute_data)
        except requests.RequestException as e:
            raise DisputeError(f"Failed to get dispute: {str(e)}") from e
    
    def get_payment_disputes(self, payment_id: str) -> List[Dispute]:
        """
        Get all disputes for a payment
        
        Args:
            payment_id: Payment ID
            
        Returns:
            List[Dispute]: List of disputes for the payment
            
        Raises:
            DisputeError: If request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/disputes",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            disputes_data = data.get("disputes", [])
            filtered = [d for d in disputes_data if d.get("paymentId") == payment_id]
            return [self._parse_dispute(d) for d in filtered]
        except requests.RequestException as e:
            raise DisputeError(f"Failed to get payment disputes: {str(e)}") from e
    
    def add_evidence(
        self,
        dispute_id: str,
        evidence: str
    ) -> Dispute:
        """
        Add evidence to a dispute
        
        Args:
            dispute_id: Dispute ID
            evidence: Evidence to add
            
        Returns:
            Dispute: Updated dispute
            
        Raises:
            DisputeError: If evidence submission fails
        """
        raise DisputeError(
            "Adding evidence after opening a dispute is not supported by this API version. "
            "Pass evidence when calling open_dispute(...)."
        )
    
    def _parse_dispute(self, data: dict) -> Dispute:
        """Parse dispute data from API response"""
        return Dispute(
            id=data["id"],
            payment_id=data["paymentId"],
            buyer_wallet_id=data["buyerWalletId"],
            provider_wallet_id=data["providerWalletId"],
            reason=data["reason"],
            status=data["status"],
            created_at=data["createdAt"],
            evidence=data.get("evidence"),
            resolution=data.get("resolution"),
            split_percent=data.get("splitPercent"),
            resolved_at=data.get("resolvedAt")
        )
