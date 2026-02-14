"""AgentPay SDK Exceptions"""


class AgentPayError(Exception):
    """Base exception for all AgentPay errors"""
    pass


class APIError(AgentPayError):
    """Raised when API returns an error response"""
    
    def __init__(self, message: str, status_code: int = None, response: dict = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class ValidationError(AgentPayError):
    """Raised when request validation fails"""
    pass


class WalletError(AgentPayError):
    """Raised for wallet-related errors"""
    pass


class ServiceError(AgentPayError):
    """Raised for service-related errors"""
    pass


class PaymentError(AgentPayError):
    """Raised for payment-related errors"""
    pass


class DisputeError(AgentPayError):
    """Raised for dispute-related errors"""
    pass


class WebhookError(AgentPayError):
    """Raised for webhook-related errors"""
    pass


class ExecutionError(AgentPayError):
    """Raised when service execution fails"""
    
    def __init__(self, message: str, execution_result: dict = None):
        super().__init__(message)
        self.execution_result = execution_result
