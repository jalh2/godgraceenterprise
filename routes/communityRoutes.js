const express = require('express');
const router = express.Router();
const {
  createCommunity,
  getAllCommunities,
  getCommunityById,
  updateCommunity,
  deleteCommunity,
  getCommunityGroups,
} = require('../controllers/communityController');

router.post('/', createCommunity);
router.get('/', getAllCommunities);
router.get('/:id', getCommunityById);
router.put('/:id', updateCommunity);
router.delete('/:id', deleteCommunity);

// Nested
router.get('/:id/groups', getCommunityGroups);

module.exports = router;
