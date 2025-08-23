const express = require('express');
const router = express.Router();
const {
  createAsset,
  getAllAssets,
  getAssetById,
  updateAsset,
  deleteAsset,
} = require('../controllers/assetController');

router.post('/', createAsset);
router.get('/', getAllAssets);
router.get('/:id', getAssetById);
router.put('/:id', updateAsset);
router.delete('/:id', deleteAsset);

module.exports = router;
