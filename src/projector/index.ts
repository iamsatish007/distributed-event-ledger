import { createKafkaConsumer } from '../shared/kafka';
import { EventEnvelope, TransactionCompletedPayload } from '../shared/types';
import { withDbTransaction } from '../shared/db';
import dotenv from 'dotenv';

dotenv.config();

const KAFKA_TOPIC = process.env.KAFKA_LEDGER_TOPIC || 'ledger-events';
const CONSUMER_GROUP = process.env.PROJECTOR_GROUP_ID || 'projector-group';

const startProjector = async () => {
  const consumer = await createKafkaConsumer({ groupId: CONSUMER_GROUP });
  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: true });

  console.log('Projector listening for Completed events...');

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;

      const eventStr = message.value.toString();
      const event: EventEnvelope<any> = JSON.parse(eventStr);

      if (event.eventType !== 'TransactionCompleted') {
        // Skip other events, we only materialize completed (and maybe failed in a real prod scenario, but user specifies Completed)
        await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
        return;
      }

      const payload = event.payload as TransactionCompletedPayload;

      try {
        await withDbTransaction(async (client) => {
          // 1. Ensure account exists, or update balance
          // Note: In real app, account might be created first. Here we upsert for simplicity if missing,
          // or run an update. The instruction says "Update the current_balance". Let's assume account exists
          // or we create it on the fly. Let's do an INSERT ... ON CONFLICT (id) DO UPDATE
          
          let balanceChange = payload.amount;
          if (payload.type === 'DEBIT') balanceChange = -payload.amount;

          // Upsert account
          await client.query(`
            INSERT INTO accounts (id, current_balance, currency, version)
            VALUES ($1, $2, 'USD', 1)
            ON CONFLICT (id) DO UPDATE 
            SET current_balance = accounts.current_balance + EXCLUDED.current_balance,
                version = accounts.version + 1
          `, [payload.accountId, balanceChange]);

          // Insert transaction ledger record
          await client.query(`
            INSERT INTO transactions_ledger (id, account_id, amount, type, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [
            payload.transactionId,
            payload.accountId,
            payload.amount,
            payload.type,
            payload.status,
            new Date(event.timestamp)
          ]);
        });

        // Commit Offset only after DB tx completes
        await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
      } catch (err) {
        console.error('Projector failed to materialize event to SQL:', err);
        throw err; // DO NOT commit offset, trigger retry
      }
    },
  });
};

startProjector().catch(console.error);
