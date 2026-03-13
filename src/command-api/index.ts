import express from 'express';
import dotenv from 'dotenv';
import { getKafkaProducer } from '../shared/kafka';
import { EventEnvelope, TransactionRequestedPayload } from '../shared/types';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.COMMAND_API_PORT || 3001;
const KAFKA_TOPIC = process.env.KAFKA_LEDGER_TOPIC || 'ledger-events';

app.post('/api/v1/transactions', async (req, res) => {
  try {
    const { accountId, amount, type, idempotencyKey } = req.body;

    if (!accountId || typeof amount !== 'number' || !type || !idempotencyKey) {
      return res.status(400).json({ error: 'Missing required fields or invalid data types' });
    }

    if (type !== 'CREDIT' && type !== 'DEBIT') {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    const payload: TransactionRequestedPayload = { accountId, amount, type };
    
    const event: EventEnvelope<TransactionRequestedPayload> = {
      eventId: randomUUID(),
      aggregateId: accountId,
      eventType: 'TransactionRequested',
      payload,
      timestamp: new Date().toISOString(),
      idempotencyKey
    };

    const producer = await getKafkaProducer();
    await producer.send({
      topic: KAFKA_TOPIC,
      messages: [
        {
          key: accountId, // Partition by accountId for strict ordering
          value: JSON.stringify(event)
        }
      ]
    });

    return res.status(202).json({ message: 'Accepted', eventId: event.eventId });
  } catch (err) {
    console.error('Error processing transaction request:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Command API listening on port ${PORT}`);
});
