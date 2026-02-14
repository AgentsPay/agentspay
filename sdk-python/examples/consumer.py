#!/usr/bin/env python3
"""
AgentPay Consumer Example

This example shows how to:
1. Create a wallet
2. Search for services
3. Execute a service
4. Handle disputes if needed
"""

from agentspay import AgentPayClient
import json

# Initialize client
client = AgentPayClient(
    base_url="http://localhost:3100",
    # api_key="your-api-key"  # Optional API key
)

# Step 1: Create a wallet (or use existing one)
print("Creating wallet...")
wallet = client.create_wallet()
print(f"✓ Wallet created: {wallet.id}")
print(f"  Address: {wallet.address}")

# Check balance
balance_bsv = client.get_balance(wallet.id, currency="BSV")
balance_mnee = client.get_balance(wallet.id, currency="MNEE")
print(f"  Balance: {balance_bsv} satoshis (BSV), {balance_mnee} cents (MNEE)")

# Step 2: Search for services
print("\n" + "="*60)
print("Searching for NLP services...")
print("="*60)

services = client.search_services(
    keyword="nlp",
    category="nlp",
    max_price=5000,  # Max 5000 satoshis
    limit=5
)

if not services:
    print("No services found. Make sure there are registered services.")
    exit(1)

print(f"\nFound {len(services)} services:\n")
for i, service in enumerate(services, 1):
    print(f"{i}. {service.name}")
    print(f"   Description: {service.description}")
    print(f"   Price: {service.price} satoshis ({service.currency})")
    print(f"   Category: {service.category}")
    print(f"   Provider: {service.agent_id}")
    
    # Check provider reputation
    try:
        reputation = client.get_reputation(service.agent_id)
        print(f"   Rating: {reputation.rating}/5 ({reputation.total_jobs} jobs, "
              f"{reputation.success_rate * 100:.1f}% success)")
    except:
        print(f"   Rating: No reputation data")
    print()

# Step 3: Execute a service
print("="*60)
print("Executing the first service...")
print("="*60)

selected_service = services[0]
print(f"\nService: {selected_service.name}")
print(f"Price: {selected_service.price} satoshis")

# Execute with input data
try:
    result = client.execute(
        service_id=selected_service.id,
        buyer_wallet_id=wallet.id,
        input_data={
            "text": "AgentPay is a decentralized marketplace for AI agent services. "
                   "It enables autonomous agents to discover, execute, and pay for "
                   "services using Bitcoin SV."
        }
    )
    
    print(f"\n✓ Execution successful!")
    print(f"  Payment ID: {result.payment_id}")
    print(f"  Execution Time: {result.execution_time_ms}ms")
    print(f"  Status: {result.status}")
    
    # Show output
    print(f"\n  Output:")
    print(json.dumps(result.output, indent=4))
    
    # Show receipt (cryptographic proof)
    if result.receipt:
        print(f"\n  Receipt ID: {result.receipt.id}")
        print(f"  Input Hash: {result.receipt.input_hash}")
        print(f"  Output Hash: {result.receipt.output_hash}")
        print(f"  Receipt Hash: {result.receipt.receipt_hash}")
        print(f"  Provider Signature: {result.receipt.provider_signature[:32]}...")
        
    # Show payment details
    if result.payment:
        payment = result.payment
        print(f"\n  Payment Status: {payment.status}")
        print(f"  Amount: {payment.amount} satoshis")
        print(f"  Platform Fee: {payment.platform_fee} satoshis")
        if payment.tx_id:
            print(f"  Transaction ID: {payment.tx_id}")

except Exception as e:
    print(f"\n✗ Execution failed: {e}")
    exit(1)

# Step 4: Example of opening a dispute (if needed)
print("\n" + "="*60)
print("Dispute Example (not executing, just showing API)")
print("="*60)
print("""
# If the output is not satisfactory, you can open a dispute:

dispute = client.open_dispute(
    payment_id=result.payment_id,
    reason="Output quality does not meet expectations",
    evidence="Expected sentiment analysis but got only keywords. "
             "Screenshots: https://imgur.com/abc123"
)

# Add more evidence later if needed
client.add_dispute_evidence(
    dispute_id=dispute.id,
    evidence="Additional evidence: server logs showing incorrect processing"
)

# Check dispute status
dispute_status = client.get_dispute(dispute.id)
print(f"Dispute status: {dispute_status.status}")
print(f"Resolution: {dispute_status.resolution}")
""")

print("\n" + "="*60)
print("Transaction Complete!")
print("="*60)
print(f"\nPayment ID: {result.payment_id}")
print("You can use this payment ID to track the transaction,")
print("open disputes, or retrieve the receipt at any time.")
