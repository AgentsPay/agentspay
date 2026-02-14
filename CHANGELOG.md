# Changelog

All notable changes to AgentsPay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-14

### Added

#### 🔗 Real BSV On-Chain Transactions
- Full integration with @bsv/sdk for real Bitcoin SV blockchain transactions
- Testnet verified and production-ready transaction handling
- Support for P2PKH addresses and transaction signing
- Real-time balance tracking and transaction history

#### 💼 Wallet Connect System
- **HandCash** integration for mobile/web wallet connectivity
- **Yours Wallet** integration for BSV ecosystem compatibility
- **Internal Wallet** system for seamless agent-to-agent payments
- Multi-wallet support per agent with automatic fallback

#### 🔐 Security Audit & Fixes
- Authentication hardening and JWT token validation
- IDOR (Insecure Direct Object Reference) vulnerability fixes
- SSRF (Server-Side Request Forgery) protection for webhook endpoints
- Rate limiting on all API endpoints (express-rate-limit)
- Input validation and sanitization across all endpoints
- Secure private key storage and encryption

#### ⚖️ Dispute Resolution System
- Structured dispute workflow (open → under_review → resolved)
- Evidence submission and tracking
- Admin resolution interface
- Automated refund/release on dispute resolution
- Dispute history and audit trail

#### 🪝 Webhook System
- 9 event types: `payment.created`, `payment.completed`, `payment.failed`, `payment.refunded`, `payment.disputed`, `service.registered`, `service.updated`, `wallet.created`, `wallet.funded`
- HMAC-SHA256 signature verification for secure webhook delivery
- Configurable webhook endpoints per service
- Automatic retry with exponential backoff
- Webhook delivery logs and monitoring

#### 📚 Swagger/OpenAPI Documentation
- Complete OpenAPI 3.0 specification (`src/docs/openapi.yaml`)
- Interactive Swagger UI at `/api-docs`
- Comprehensive endpoint documentation with examples
- Request/response schema definitions
- Authentication flow documentation

#### 🔏 Service Execution Verification
- Cryptographic proof generation for all service executions
- SHA-256 hashing of request/response data
- OP_RETURN data embedding in BSV transactions
- Verifiable execution proofs on-chain
- Proof validation API endpoints

#### 💵 MNEE Stablecoin Support
- BSV-native USD 1:1 stablecoin integration
- Multi-currency support (BSV + MNEE)
- Automatic currency conversion
- MNEE balance tracking and transactions
- Stablecoin metadata in payment records

### Changed
- Updated payment flow to use real BSV transactions instead of mock balance system
- Enhanced error handling and validation across all endpoints
- Improved database schema with new tables for disputes, webhooks, and proofs
- Updated SDK to support new wallet types and verification features

### Fixed
- Wallet creation race conditions
- Payment state consistency issues
- Service registry search performance
- Balance calculation edge cases

### Security
- Implemented comprehensive input validation
- Added rate limiting to prevent abuse
- Fixed authentication bypass vulnerabilities
- Hardened webhook endpoint security
- Improved error messages to prevent information leakage

## [0.1.0] - 2026-02-01

### Added
- Initial release of AgentsPay
- Core marketplace API with service registry
- Basic payment engine with escrow/release/refund
- Mock wallet system for development
- Service discovery and search
- SDK for TypeScript/JavaScript agents
- SQLite-based data persistence
- Basic reputation system
- Demo scripts and documentation

---

For more details, visit [agentspay.dev](https://agentspay.dev) or the [GitHub repository](https://github.com/agentspay/agentspay).
