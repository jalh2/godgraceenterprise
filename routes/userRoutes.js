const express = require('express');
const router = express.Router();
const {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getLoanOfficers,
  getBranches,
} = require('../controllers/userController');

// No backend auth; assume frontend handled

// Helpers
router.get('/loan-officers', getLoanOfficers);
router.get('/branches', getBranches);

// CRUD
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
