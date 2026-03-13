CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(255) PRIMARY KEY,
    current_balance DECIMAL(15, 4) NOT NULL DEFAULT 0.0000,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions_ledger (
    id VARCHAR(255) PRIMARY KEY,
    account_id VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 4) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('COMPLETED', 'FAILED', 'PENDING')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_account 
        FOREIGN KEY(account_id) 
        REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions_ledger(account_id);
