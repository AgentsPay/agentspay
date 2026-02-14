"""Service operations for AgentPay SDK"""

from typing import Optional, List
import requests
from .types import Service, ServiceQuery
from .exceptions import ServiceError


class ServiceOperations:
    """Handles service registration and discovery"""
    
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url
        self.api_key = api_key
    
    def _get_headers(self) -> dict:
        """Get request headers with API key if available"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
    
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
        """
        Register a new service
        
        Args:
            agent_id: Provider wallet ID
            name: Service name
            description: Service description
            price: Price per execution (satoshis for BSV, cents for MNEE)
            endpoint: Service endpoint URL
            category: Service category
            currency: "BSV" or "MNEE"
            method: HTTP method ("POST" or "GET")
            timeout: Max execution time in seconds
            dispute_window: Dispute window in minutes
            input_schema: Optional JSON schema for input validation
            output_schema: Optional JSON schema for output validation
            
        Returns:
            Service: The registered service
            
        Raises:
            ServiceError: If registration fails
        """
        payload = {
            "agentId": agent_id,
            "name": name,
            "description": description,
            "category": category,
            "price": price,
            "currency": currency.upper(),
            "endpoint": endpoint,
            "method": method.upper(),
            "timeout": timeout,
            "disputeWindow": dispute_window
        }
        
        if input_schema:
            payload["inputSchema"] = input_schema
        if output_schema:
            payload["outputSchema"] = output_schema
        
        try:
            response = requests.post(
                f"{self.base_url}/api/services",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            service_data = data.get("service")
            if not service_data:
                raise ServiceError("Invalid response: missing service data")
            
            return self._parse_service(service_data)
        except requests.RequestException as e:
            raise ServiceError(f"Failed to register service: {str(e)}") from e
    
    def search_services(
        self,
        keyword: Optional[str] = None,
        category: Optional[str] = None,
        max_price: Optional[int] = None,
        min_rating: Optional[float] = None,
        limit: int = 20,
        offset: int = 0
    ) -> List[Service]:
        """
        Search for services
        
        Args:
            keyword: Search keyword
            category: Filter by category
            max_price: Maximum price filter
            min_rating: Minimum rating filter
            limit: Max results to return
            offset: Result offset for pagination
            
        Returns:
            List[Service]: List of matching services
            
        Raises:
            ServiceError: If search fails
        """
        params = {}
        if keyword:
            params["q"] = keyword
        if category:
            params["category"] = category
        if max_price is not None:
            params["maxPrice"] = str(max_price)
        if min_rating is not None:
            params["minRating"] = str(min_rating)
        if limit:
            params["limit"] = str(limit)
        if offset:
            params["offset"] = str(offset)
        
        try:
            response = requests.get(
                f"{self.base_url}/api/services",
                params=params,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            services_data = data.get("services", [])
            return [self._parse_service(s) for s in services_data]
        except requests.RequestException as e:
            raise ServiceError(f"Failed to search services: {str(e)}") from e
    
    def get_service(self, service_id: str) -> Service:
        """
        Get service by ID
        
        Args:
            service_id: Service ID
            
        Returns:
            Service: The service
            
        Raises:
            ServiceError: If service not found or request fails
        """
        try:
            response = requests.get(
                f"{self.base_url}/api/services/{service_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            service_data = data.get("service")
            if not service_data:
                raise ServiceError(f"Service {service_id} not found")
            
            return self._parse_service(service_data)
        except requests.RequestException as e:
            raise ServiceError(f"Failed to get service: {str(e)}") from e
    
    def _parse_service(self, data: dict) -> Service:
        """Parse service data from API response"""
        return Service(
            id=data["id"],
            agent_id=data["agentId"],
            name=data["name"],
            description=data["description"],
            category=data["category"],
            price=data["price"],
            currency=data["currency"],
            endpoint=data["endpoint"],
            method=data["method"],
            active=data["active"],
            timeout=data.get("timeout", 30),
            dispute_window=data.get("disputeWindow", 30),
            created_at=data["createdAt"],
            updated_at=data["updatedAt"],
            input_schema=data.get("inputSchema"),
            output_schema=data.get("outputSchema")
        )
