"""Tests for AgentPay SDK"""

import pytest
from unittest.mock import Mock, patch
from agentspay import AgentPayClient
from agentspay.exceptions import WalletError, ServiceError, ExecutionError


class TestAgentPayClient:
    """Test suite for AgentPayClient"""
    
    def test_client_initialization(self):
        """Test client initializes with correct defaults"""
        client = AgentPayClient()
        assert client.base_url == "http://localhost:3100"
        assert client.api_key is None
        
        client_with_key = AgentPayClient(
            base_url="https://api.agentspay.io",
            api_key="test-key"
        )
        assert client_with_key.base_url == "https://api.agentspay.io"
        assert client_with_key.api_key == "test-key"
    
    @patch('agentspay.wallet.requests.post')
    def test_create_wallet(self, mock_post):
        """Test wallet creation"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "wallet": {
                "id": "wallet_123",
                "publicKey": "pub_key_abc",
                "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
                "createdAt": "2026-02-14T12:00:00Z",
                "balance": 100000,
                "balanceMnee": 5000
            }
        }
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response
        
        # Test
        client = AgentPayClient()
        wallet = client.create_wallet()
        
        assert wallet.id == "wallet_123"
        assert wallet.public_key == "pub_key_abc"
        assert wallet.address == "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
        assert wallet.balance == 100000
        assert wallet.balance_mnee == 5000
    
    @patch('agentspay.wallet.requests.get')
    def test_get_wallet(self, mock_get):
        """Test getting wallet by ID"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "wallet": {
                "id": "wallet_123",
                "publicKey": "pub_key_abc",
                "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
                "createdAt": "2026-02-14T12:00:00Z",
                "balance": 50000
            }
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        # Test
        client = AgentPayClient()
        wallet = client.get_wallet("wallet_123")
        
        assert wallet.id == "wallet_123"
        assert wallet.balance == 50000
    
    @patch('agentspay.services.requests.post')
    def test_register_service(self, mock_post):
        """Test service registration"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "service": {
                "id": "service_456",
                "agentId": "wallet_123",
                "name": "TextAnalyzer",
                "description": "NLP service",
                "category": "nlp",
                "price": 1000,
                "currency": "BSV",
                "endpoint": "https://agent.com/analyze",
                "method": "POST",
                "active": True,
                "timeout": 30,
                "disputeWindow": 30,
                "createdAt": "2026-02-14T12:00:00Z",
                "updatedAt": "2026-02-14T12:00:00Z"
            }
        }
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response
        
        # Test
        client = AgentPayClient()
        service = client.register_service(
            agent_id="wallet_123",
            name="TextAnalyzer",
            description="NLP service",
            price=1000,
            currency="BSV",
            endpoint="https://agent.com/analyze",
            category="nlp"
        )
        
        assert service.id == "service_456"
        assert service.name == "TextAnalyzer"
        assert service.price == 1000
        assert service.currency == "BSV"
        assert service.active is True
    
    @patch('agentspay.services.requests.get')
    def test_search_services(self, mock_get):
        """Test searching for services"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "services": [
                {
                    "id": "service_1",
                    "agentId": "wallet_1",
                    "name": "Service 1",
                    "description": "Test service",
                    "category": "nlp",
                    "price": 500,
                    "currency": "BSV",
                    "endpoint": "https://agent.com/1",
                    "method": "POST",
                    "active": True,
                    "timeout": 30,
                    "disputeWindow": 30,
                    "createdAt": "2026-02-14T12:00:00Z",
                    "updatedAt": "2026-02-14T12:00:00Z"
                }
            ]
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response
        
        # Test
        client = AgentPayClient()
        services = client.search_services(keyword="nlp", max_price=1000)
        
        assert len(services) == 1
        assert services[0].id == "service_1"
        assert services[0].category == "nlp"
    
    @patch('agentspay.payments.requests.post')
    def test_execute_service(self, mock_post):
        """Test service execution"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "paymentId": "payment_789",
            "serviceId": "service_456",
            "output": {
                "result": "success",
                "data": "analyzed"
            },
            "executionTimeMs": 250,
            "status": "success"
        }
        mock_response.raise_for_status = Mock()
        mock_post.return_value = mock_response
        
        # Test
        client = AgentPayClient()
        result = client.execute(
            service_id="service_456",
            buyer_wallet_id="wallet_123",
            input_data={"text": "Test"}
        )
        
        assert result.payment_id == "payment_789"
        assert result.service_id == "service_456"
        assert result.status == "success"
        assert result.execution_time_ms == 250
        assert result.output["result"] == "success"


class TestExceptions:
    """Test SDK exceptions"""
    
    @patch('agentspay.wallet.requests.post')
    def test_wallet_error(self, mock_post):
        """Test WalletError is raised on API failure"""
        mock_post.side_effect = Exception("Network error")
        
        client = AgentPayClient()
        with pytest.raises(WalletError):
            client.create_wallet()
    
    @patch('agentspay.services.requests.post')
    def test_service_error(self, mock_post):
        """Test ServiceError is raised on API failure"""
        mock_post.side_effect = Exception("API error")
        
        client = AgentPayClient()
        with pytest.raises(ServiceError):
            client.register_service(
                agent_id="wallet_123",
                name="Test",
                description="Test",
                price=100,
                currency="BSV",
                endpoint="https://test.com",
                category="test"
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
