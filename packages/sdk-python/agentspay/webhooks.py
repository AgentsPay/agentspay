"""Webhook management for AgentPay SDK"""

from typing import Optional, List
import requests
from .types import Webhook
from .exceptions import WebhookError


class WebhookOperations:
    """Handles webhook registration and management"""
    
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
    
    def register_webhook(
        self,
        url: str,
        events: List[str]
    ) -> Webhook:
        """
        Register a new webhook
        
        Args:
            url: Webhook endpoint URL
            events: List of events to subscribe to
                   (e.g., ["payment.completed", "payment.failed", "dispute.opened"])
            
        Returns:
            Webhook: The registered webhook
            
        Raises:
            WebhookError: If registration fails
        """
        payload = {
            "url": url,
            "events": events
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/api/webhooks",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            webhook_data = data.get("webhook")
            if not webhook_data:
                raise WebhookError("Invalid response: missing webhook data")
            
            return self._parse_webhook(webhook_data)
        except requests.RequestException as e:
            raise WebhookError(f"Failed to register webhook: {str(e)}") from e
    
    def get_webhook(self, webhook_id: str) -> Webhook:
        """
        Get webhook by ID
        
        Args:
            webhook_id: Webhook ID
            
        Returns:
            Webhook: The webhook
            
        Raises:
            WebhookError: If webhook not found or request fails
        """
        try:
            webhooks = self.list_webhooks()
            for webhook in webhooks:
                if webhook.id == webhook_id:
                    return webhook
            raise WebhookError(f"Webhook {webhook_id} not found")
        except WebhookError:
            raise
        except requests.RequestException as e:
            raise WebhookError(f"Failed to get webhook: {str(e)}") from e
    
    def list_webhooks(self) -> List[Webhook]:
        """
        List all registered webhooks
        
        Returns:
            List[Webhook]: List of webhooks
            
        Raises:
            WebhookError: If request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/webhooks",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            webhooks_data = data.get("webhooks", [])
            return [self._parse_webhook(w) for w in webhooks_data]
        except requests.RequestException as e:
            raise WebhookError(f"Failed to list webhooks: {str(e)}") from e
    
    def delete_webhook(self, webhook_id: str) -> bool:
        """
        Delete a webhook
        
        Args:
            webhook_id: Webhook ID
            
        Returns:
            bool: True if deleted successfully
            
        Raises:
            WebhookError: If deletion fails
        """
        try:
            response = requests.delete(
                f"{self.base_url}/api/webhooks/{webhook_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            return True
        except requests.RequestException as e:
            raise WebhookError(f"Failed to delete webhook: {str(e)}") from e
    
    def update_webhook(
        self,
        webhook_id: str,
        url: Optional[str] = None,
        events: Optional[List[str]] = None,
        active: Optional[bool] = None
    ) -> Webhook:
        """
        Update a webhook
        
        Args:
            webhook_id: Webhook ID
            url: New URL (optional)
            events: New events list (optional)
            active: Active status (optional)
            
        Returns:
            Webhook: Updated webhook
            
        Raises:
            WebhookError: If update fails
        """
        payload = {}
        if url is not None:
            payload["url"] = url
        if events is not None:
            payload["events"] = events
        if active is not None:
            payload["active"] = active
        
        try:
            response = requests.put(
                f"{self.base_url}/api/webhooks/{webhook_id}",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            webhook_data = data.get("webhook")
            if not webhook_data:
                raise WebhookError("Invalid response: missing webhook data")
            
            return self._parse_webhook(webhook_data)
        except requests.RequestException as e:
            raise WebhookError(f"Failed to update webhook: {str(e)}") from e
    
    def _parse_webhook(self, data: dict) -> Webhook:
        """Parse webhook data from API response"""
        return Webhook(
            id=data["id"],
            url=data["url"],
            events=data["events"],
            active=data["active"],
            created_at=data["createdAt"],
            secret=data.get("secret")
        )
