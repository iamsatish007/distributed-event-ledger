# Distributed Event Ledger

A high-throughput, distributed financial ledger built with Node.js, TypeScript, Apache Kafka, PostgreSQL, and Redis. The system uses Event Sourcing and Command Query Responsibility Segregation (CQRS) architectural patterns to achieve high performance, scalability, and exact-once processing semantics.

## Architecture Overview

The system architecture is divided into clear boundaries separating reads and writes (CQRS):

1. **Command API**: An Express.js REST API that accepts transaction requests (CREDIT/DEBIT). It acts as the gateway to the system and writes `TransactionRequested` events directly to an Apache Kafka topic for asynchronous processing.
2. **Worker Service**: A distributed worker that consumes `TransactionRequested` events from Kafka. It ensures EXACTLY-ONCE processing (idempotency) using Redis-distributed locks (`redlock`). It validates transactions (like checking for sufficient funds for debits) and publishes `TransactionCompleted` or `TransactionFailed` events back to Kafka.
3. **Projector Service**: A background service that listens to `TransactionCompleted` events from Kafka and materializes them into read-optimized SQL views in PostgreSQL. It updates account balances and records the ledger atomically using DB transactions.
4. **Query API**: An Express.js REST API dedicated to serving fast reads directly from the materialized PostgreSQL views.

### Technologies Used

- **Node.js & TypeScript**: Core application logic.
- **Apache Kafka**: Event Bus / Event Store ensuring message durability, strict ordering per account (via partition keys), and scalable event distribution.
- **PostgreSQL**: Stores materialized views for Accounts and the Transaction Ledger.
- **Redis**: Distributed locking mechanism ensuring exact-once idempotency for transaction requests.

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` (Node Package Manager)

## Setup and Installation

1. **Clone the repository** and navigate to the project directory:

   ```bash
   git clone https://github.com/iamsatish007/distributed-event-ledger.git
   cd distributed-event-ledger
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Start the Infrastructure**:
   The required infrastructure (PostgreSQL, Redis, and Apache Kafka) is defined in `docker-compose.yml`.

   ```bash
   docker-compose up -d
   ```
   
   *Note: PostgreSQL exposes port `5433` locally to avoid conflicts with default Postgres installations. Redis exposes `6380`.*

4. **Environment Variables**:
   By default, the application accesses infrastructure via configuration stored in `.env.example`. Review `.env.example` and optionally copy it to `.env`.

## Running the Application

The application consists of four independent microservices. You can start them in separate terminal windows:

**1. Start the Command API** (Runs on port `3001`)
```bash
npm run start:command
```

**2. Start the Query API** (Runs on port `3002`)
```bash
npm run start:query
```

**3. Start the Worker Service**
```bash
npm run start:worker
```

**4. Start the Projector Service**
```bash
npm run start:projector
```

*(Optional)* Run the load test script:
```bash
npm run test:load
```

## API Documentation

### Command API

#### 1. Request a Transaction
- **Endpoint**: `POST /api/v1/transactions`
- **Description**: Initiates a financial transaction (Credit or Debit). The request is asynchronous.
- **Body**:
  ```json
  {
    "accountId": "string",
    "amount": number,
    "type": "CREDIT" | "DEBIT",
    "idempotencyKey": "string (unique UUID per request)"
  }
  ```
- **Response**: `202 Accepted`
  ```json
  {
    "message": "Accepted",
    "eventId": "uuid"
  }
  ```

### Query API

#### 1. Get Account Balance
- **Endpoint**: `GET /api/v1/accounts/:accountId/balance`
- **Description**: Retrieves the current materialized balance of an account.
- **Response**: `200 OK`
  ```json
  {
    "accountId": "string",
    "balance": number
  }
  ```

#### 2. Get Transaction History
- **Endpoint**: `GET /api/v1/accounts/:accountId/transactions?page=1&limit=50`
- **Description**: Retrieves the materialized ledger of transactions for a specific account. Supports pagination.
- **Response**: `200 OK`
  ```json
  {
    "accountId": "string",
    "page": 1,
    "limit": 50,
    "results": [
      {
        "id": "uuid",
        "account_id": "string",
        "amount": 100,
        "type": "CREDIT",
        "status": "COMPLETED",
        "created_at": "2023-10-04T12:00:00Z"
      }
    ]
  }
  ```

## Event Schemas (Internal)

- `TransactionRequested`
- `TransactionCompleted`
- `TransactionFailed`

All events follow a standardized `EventEnvelope` format.
