import { Kafka, Producer, Consumer, ConsumerConfig } from 'kafkajs';
import dotenv from 'dotenv';
dotenv.config();

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

export const kafka = new Kafka({
  clientId: 'ledger-app',
  brokers,
});

let producer: Producer;

export const getKafkaProducer = async (): Promise<Producer> => {
  if (!producer) {
    producer = kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });
    await producer.connect();
  }
  return producer;
};

export const createKafkaConsumer = async (config: ConsumerConfig): Promise<Consumer> => {
  const consumer = kafka.consumer(config);
  await consumer.connect();
  return consumer;
};
