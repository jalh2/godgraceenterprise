require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const userIdentity = require('./middleware/userIdentity');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(userIdentity);

// Simple request logger (terminal)
app.use((req, res, next) => {
  const start = Date.now();
  const safeBody = (() => {
    try {
      if (!req.body) return undefined;
      const str = JSON.stringify(req.body);
      return str.length > 500 ? str.slice(0, 500) + '...<truncated>' : str;
    } catch (_) {
      return '[unserializable body]';
    }
  })();
  console.log(`[REQ] ${req.method} ${req.originalUrl}`, {
    query: req.query,
    body: safeBody,
  });
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Health route
app.get('/', (req, res) => {
  res.send('God Grace Enterprise INC Micro Loan Service API');
});

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/groups', require('./routes/groupRoutes'));
app.use('/api/clients', require('./routes/clientRoutes'));
app.use('/api/loans', require('./routes/loanRoutes'));
app.use('/api/savings', require('./routes/savingsRoutes'));
app.use('/api/assets', require('./routes/assetRoutes'));
app.use('/api/distributions', require('./routes/distributionRoutes'));
app.use('/api/metrics', require('./routes/metricsRoutes'));

// MongoDB Connection
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server is listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error.message);
    process.exit(1);
  });
