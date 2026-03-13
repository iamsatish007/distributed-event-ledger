export interface EventEnvelope<T = any> {
  eventId: string;
  aggregateId: string;
  eventType: string;
  payload: T;
  timestamp: string;
  idempotencyKey: string;
}

export interface TransactionRequestedPayload {
  accountId: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
}

export interface TransactionCompletedPayload {
  accountId: string;
  transactionId: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  status: 'COMPLETED';
}

export interface TransactionFailedPayload {
  accountId: string;
  transactionId: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  status: 'FAILED';
  reason: string;
}

export interface Account {
  id: string; // matches account_id in db
  current_balance: number;
  currency: string;
  version: number;
}

export interface TransactionLedger {
  id: string;
  account_id: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  created_at: Date;
}
