"""Wallet operations for AgentPay SDK"""

from typing import Optional
import requests
from .types import AgentWallet
from .exceptions import WalletError, APIError


class WalletOperations:
    """Handles wallet-related operations"""
    
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url
        self.api_key = api_key
    
    def _get_headers(self) -> dict:
        """Get request headers with API key if available"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
    
    def create_wallet(self) -> AgentWallet:
        """
        Create a new agent wallet
        
        Returns:
            AgentWallet: The created wallet
            
        Raises:
            WalletError: If wallet creation fails
        """
        try:
            response = requests.post(
                f"{self.base_url}/api/wallets",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            wallet_data = data.get("wallet")
            if not wallet_data:
                raise WalletError("Invalid response: missing wallet data")
            
            return AgentWallet(
                id=wallet_data["id"],
                public_key=wallet_data["publicKey"],
                address=wallet_data["address"],
                created_at=wallet_data["createdAt"],
                balance=wallet_data.get("balance"),
                balance_mnee=wallet_data.get("balanceMnee")
            )
        except requests.RequestException as e:
            raise WalletError(f"Failed to create wallet: {str(e)}") from e
    
    def get_wallet(self, wallet_id: str) -> AgentWallet:
        """
        Get wallet by ID
        
        Args:
            wallet_id: Wallet ID
            
        Returns:
            AgentWallet: The wallet
            
        Raises:
            WalletError: If wallet not found or request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/wallets/{wallet_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            wallet_data = data.get("wallet")
            if not wallet_data:
                raise WalletError(f"Wallet {wallet_id} not found")
            
            return AgentWallet(
                id=wallet_data["id"],
                public_key=wallet_data["publicKey"],
                address=wallet_data["address"],
                created_at=wallet_data["createdAt"],
                balance=wallet_data.get("balance"),
                balance_mnee=wallet_data.get("balanceMnee")
            )
        except requests.RequestException as e:
            raise WalletError(f"Failed to get wallet: {str(e)}") from e
    
    def get_balance(self, wallet_id: str, currency: str = "BSV") -> int:
        """
        Get wallet balance for a specific currency
        
        Args:
            wallet_id: Wallet ID
            currency: "BSV" or "MNEE"
            
        Returns:
            int: Balance in satoshis (BSV) or cents (MNEE)
            
        Raises:
            WalletError: If balance cannot be retrieved
        """
        wallet = self.get_wallet(wallet_id)
        
        if currency.upper() == "BSV":
            return wallet.balance or 0
        elif currency.upper() == "MNEE":
            return wallet.balance_mnee or 0
        else:
            raise WalletError(f"Invalid currency: {currency}")
