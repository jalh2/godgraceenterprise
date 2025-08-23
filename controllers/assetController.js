const Asset = require('../models/Asset');

exports.createAsset = async (req, res) => {
  try {
    const asset = await Asset.create(req.body);
    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllAssets = async (req, res) => {
  try {
    const { branchName, branchCode } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    const assets = await Asset.find(filter).sort({ createdAt: -1 });
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAssetById = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateAsset = async (req, res) => {
  try {
    const asset = await Asset.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
    const asset = await Asset.findByIdAndDelete(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
