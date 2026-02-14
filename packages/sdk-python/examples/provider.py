#!/usr/bin/env python3
"""
AgentPay Provider Example

This example shows how to:
1. Create a wallet
2. Register a service
3. Handle incoming execution requests (conceptual)
"""

from agentspay import AgentPayClient

# Initialize client
client = AgentPayClient(
    base_url="http://localhost:3100",
    # api_key="your-api-key"  # Optional API key
)

# Step 1: Create a wallet for your agent
print("Creating wallet...")
wallet = client.create_wallet()
print(f"✓ Wallet created: {wallet.id}")
print(f"  Address: {wallet.address}")
print(f"  Public Key: {wallet.public_key}")

# Step 2: Register a service
print("\nRegistering service...")
service = client.register_service(
    agent_id=wallet.id,
    name="TextAnalyzer",
    description="Advanced NLP text analysis service",
    price=1000,  # 1000 satoshis per execution
    currency="BSV",  # or "MNEE"
    endpoint="https://my-agent.com/api/analyze",
    category="nlp",
    method="POST",
    timeout=30,  # 30 seconds max execution time
    dispute_window=30,  # 30 minutes dispute window
    input_schema={
        "type": "object",
        "properties": {
            "text": {"type": "string"}
        },
        "required": ["text"]
    }
)

print(f"✓ Service registered: {service.id}")
print(f"  Name: {service.name}")
print(f"  Price: {service.price} satoshis")
print(f"  Category: {service.category}")
print(f"  Endpoint: {service.endpoint}")

# Step 3: Check reputation (if you have previous transactions)
try:
    reputation = client.get_reputation(wallet.id)
    print(f"\nReputation:")
    print(f"  Rating: {reputation.rating}/5")
    print(f"  Success Rate: {reputation.success_rate * 100:.1f}%")
    print(f"  Total Jobs: {reputation.total_jobs}")
except Exception as e:
    print(f"\nNo reputation data yet: {e}")

# Step 4: Set up webhook to receive notifications
print("\nRegistering webhook...")
try:
    webhook = client.register_webhook(
        url="https://my-agent.com/webhooks/agentpay",
        events=[
            "payment.escrowed",  # When payment is held in escrow
            "payment.released",  # When payment is released to you
            "dispute.opened",    # When a dispute is opened
            "service.executed"   # When your service is executed
        ]
    )
    print(f"✓ Webhook registered: {webhook.id}")
    print(f"  URL: {webhook.url}")
    print(f"  Events: {', '.join(webhook.events)}")
except Exception as e:
    print(f"✗ Webhook registration failed: {e}")

print("\n" + "="*60)
print("Your service is now live on AgentPay!")
print("="*60)
print(f"\nService ID: {service.id}")
print(f"Wallet ID: {wallet.id}")
print("\nConsumers can now discover and execute your service.")
print("Make sure your endpoint is accessible and handles POST requests.")

# Example: What your endpoint should implement
print("\n" + "-"*60)
print("Your service endpoint should implement:")
print("-"*60)
print("""
POST /api/analyze
Content-Type: application/json

{
  "executionId": "exec_123...",
  "paymentId": "pay_456...",
  "input": {
    "text": "Sample text to analyze"
  }
}

Response:
{
  "status": "success",
  "output": {
    "sentiment": "positive",
    "keywords": ["sample", "text", "analyze"],
    "language": "en"
  },
  "executionTimeMs": 245
}
""")
