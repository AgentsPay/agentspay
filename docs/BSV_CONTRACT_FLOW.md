# BSV Contract + Signature Flow

## What is implemented now

1. `POST /api/execute/:serviceId` now creates a signed `service_contract` before escrow payment.
2. Contract includes buyer/provider identities, amount, currency, dispute window, and `termsHash`.
3. Both parties sign `AgentPayContract:<contractHash>` with BSV-compatible message signatures.
4. Contract hash is anchored on-chain using OP_RETURN (best effort, txid stored when available).
5. Payment is linked to `contractId`.
6. Contract status is updated on settlement:
   - `released`
   - `refunded`
   - `disputed`

## Verification endpoints

- Get contract:
  - `GET /api/contracts/:id` (buyer/provider/admin)
- Verify signatures and hash integrity:
  - `GET /api/contracts/:id/verify`

## Important note

Current escrow locking is platform escrow (funds moved to escrow wallet), not yet full on-chain 2-of-3 multisig spending policy.

This still provides:
- signed bilateral contract proof,
- on-chain hash anchor,
- payment/contract linkage for dispute evidence.

## Next step (recommended)

Upgrade escrow UTXO policy to true 2-of-3 multisig (`buyer + provider + admin-arbiter`) for trust-minimized unlock in disputes.
