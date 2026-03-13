import { createKafkaConsumer, getKafkaProducer } from '../shared/kafka';
import { acquireLock } from '../shared/redis';
import { EventEnvelope, TransactionRequestedPayload, TransactionCompletedPayload, TransactionFailedPayload } from '../shared/types';
import { pool } from '../shared/db';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const KAFKA_TOPIC = process.env.KAFKA_LEDGER_TOPIC || 'ledger-events';
const CONSUMER_GROUP = process.env.WORKER_GROUP_ID || 'ledger-workers';

const startWorker = async () => {
  const consumer = await createKafkaConsumer({ groupId: CONSUMER_GROUP });
  const producer = await getKafkaProducer();

  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: true });

  console.log('Worker listening for events...');

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;

      const eventStr = message.value.toString();
      const event: EventEnvelope<any> = JSON.parse(eventStr);

      if (event.eventType !== 'TransactionRequested') {
        // Skip irrelevant events for this worker
        await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
        return;
      }

      const reqPayload = event.payload as TransactionRequestedPayload;
      const idempotencyKey = `ledger:idempotency:${event.idempotencyKey}`;

      let lock;
      try {
        // ttl 24 hours (86400000 ms)
        lock = await acquireLock(idempotencyKey, 86400000);
      } catch (err) {
        console.log(`Duplicate Request: ${event.idempotencyKey}. Skipping.`);
        await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
        return;
      }

      // Lock acquired, process transaction
      try {
        let isFailed = false;
        let failReason = '';

        if (reqPayload.type === 'DEBIT') {
          // Validate logic (simulate async checking balance)
          // We don't deduct here, we just validate if current_balance > amount
          const client = await pool.connect();
          try {
            const result = await client.query('SELECT current_balance FROM accounts WHERE id = $1', [reqPayload.accountId]);
            const balance = result.rows.length ? Number(result.rows[0].current_balance) : 0;
            if (balance < reqPayload.amount) {
              isFailed = true;
              failReason = 'Insufficient funds';
            }
          } finally {
            client.release();
          }
        }

        const newEventId = randomUUID();
        const transactionId = randomUUID();

        if (isFailed) {
          const failedPayload: TransactionFailedPayload = {
            accountId: reqPayload.accountId,
            transactionId,
            amount: reqPayload.amount,
            type: reqPayload.type,
            status: 'FAILED',
            reason: failReason,
          };
          const outEvent: EventEnvelope<TransactionFailedPayload> = {
            eventId: newEventId,
            aggregateId: reqPayload.accountId,
            eventType: 'TransactionFailed',
            payload: failedPayload,
            timestamp: new Date().toISOString(),
            idempotencyKey: event.idempotencyKey
          };
          await producer.send({
            topic: KAFKA_TOPIC,
            messages: [{ key: reqPayload.accountId, value: JSON.stringify(outEvent) }]
          });
        } else {
          const completedPayload: TransactionCompletedPayload = {
            accountId: reqPayload.accountId,
            transactionId,
            amount: reqPayload.amount,
            type: reqPayload.type,
            status: 'COMPLETED',
          };
          const outEvent: EventEnvelope<TransactionCompletedPayload> = {
            eventId: newEventId,
            aggregateId: reqPayload.accountId,
            eventType: 'TransactionCompleted',
            payload: completedPayload,
            timestamp: new Date().toISOString(),
            idempotencyKey: event.idempotencyKey
          };
          await producer.send({
            topic: KAFKA_TOPIC,
            messages: [{ key: reqPayload.accountId, value: JSON.stringify(outEvent) }]
          });
        }

        // Commit offset to kafka
        await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
      } catch (err) {
        console.error('Error processing event:', err);
        // We do not commit offset so it can be retried, but we also lost the lock.
        // Wait, if it fails here, we should release lock to allow retry.
        if (lock) {
          try {
            await lock.release();
          } catch (unlockErr) {
            console.error('Failed to release lock after processing error', unlockErr);
          }
        }
        throw err;
      }
    },
  });
};

startWorker().catch(console.error);
