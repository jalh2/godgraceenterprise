require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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
