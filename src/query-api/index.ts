import express from 'express';
import dotenv from 'dotenv';
import { pool } from '../shared/db';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.QUERY_API_PORT || 3002;

app.get('/api/v1/accounts/:accountId/balance', async (req, res) => {
  try {
    const { accountId } = req.params;
    const result = await pool.query('SELECT current_balance FROM accounts WHERE id = $1', [accountId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    return res.json({ accountId, balance: Number(result.rows[0].current_balance) });
  } catch (err) {
    console.error('Error fetching balance:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/v1/accounts/:accountId/transactions', async (req, res) => {
  try {
    const { accountId } = req.params;
    let page = parseInt(req.query.page as string) || 1;
    let limit = parseInt(req.query.limit as string) || 50;

    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const result = await pool.query(
      'SELECT * FROM transactions_ledger WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [accountId, limit, offset]
    );

    return res.json({
      accountId,
      page,
      limit,
      results: result.rows
    });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Query API listening on port ${PORT}`);
});
