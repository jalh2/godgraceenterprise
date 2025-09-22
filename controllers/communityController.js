const Community = require('../models/Community');
const Group = require('../models/Group');
const Counter = require('../models/Counter');

// Create Community
exports.createCommunity = async (req, res) => {
  try {
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    const base = { ...req.body };
    // Never trust incoming communityCode; it will be auto-generated
    if (Object.prototype.hasOwnProperty.call(base, 'communityCode')) delete base.communityCode;
    if (user && user.email) base.createdByEmail = user.email;
    if (restricted && user) {
      base.branchName = user.branchName;
      base.branchCode = user.branchCode;
    }

    // Generate unique community code using Counter with retry (similar to passbook)
    let created;
    for (let attempt = 0; attempt < 5; attempt++) {
      const counter = await Counter.findByIdAndUpdate(
        'community',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const generatedCode = `COM-${String(counter.seq).padStart(6, '0')}`;
      try {
        created = await Community.create({ ...base, communityCode: generatedCode });
        break;
      } catch (e) {
        if (e && e.code === 11000 && /communityCode/i.test(e.message || '')) {
          // Duplicate collision, retry
          continue;
        }
        throw e;
      }
    }

    if (!created) return res.status(500).json({ error: 'Failed to allocate community code' });
    return res.status(201).json(created);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

// Get all Communities (with branch scoping & optional search)
exports.getAllCommunities = async (req, res) => {
  try {
    const { branchName, branchCode, search, status } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (status) filter.status = status;

    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.createdByEmail = user.email;
      if (!branchCode) filter.branchCode = user.branchCode;
    }

    if (search && String(search).trim()) {
      const term = String(search).trim();
      filter.$or = [
        { communityName: { $regex: term, $options: 'i' } },
        { communityCode: { $regex: term, $options: 'i' } },
        { location: { $regex: term, $options: 'i' } },
      ];
    }

    const items = await Community.find(filter).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get Community by ID
exports.getCommunityById = async (req, res) => {
  try {
    const id = req.params.id;
    const community = await Community.findById(id);
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!community.createdByEmail || community.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    res.json(community);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update Community
exports.updateCommunity = async (req, res) => {
  try {
    const existing = await Community.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Community not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!existing.createdByEmail || existing.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const payload = { ...req.body };
    // Prevent updates to communityCode
    if (Object.prototype.hasOwnProperty.call(payload, 'communityCode')) {
      delete payload.communityCode;
    }
    if (restricted && user) {
      payload.branchName = user.branchName;
      payload.branchCode = user.branchCode;
      payload.createdByEmail = user.email;
    }
    const updated = await Community.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete Community (guard if there are groups)
exports.deleteCommunity = async (req, res) => {
  try {
    const existing = await Community.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Community not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!existing.createdByEmail || existing.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const count = await Group.countDocuments({ community: existing._id });
    if (count > 0) {
      return res.status(400).json({ error: 'Cannot delete community with associated groups' });
    }
    await Community.findByIdAndDelete(req.params.id);
    res.json({ message: 'Community deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// List Groups under a Community (optionally include clients)
exports.getCommunityGroups = async (req, res) => {
  try {
    const id = req.params.id;
    const includeClients = String(req.query.includeClients || 'true').toLowerCase() === 'true';
    const { branchCode } = req.query;
    const filter = { community: id };
    if (branchCode) filter.branchCode = branchCode;

    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.createdByEmail = user.email;
      if (!branchCode) filter.branchCode = user.branchCode;
    }

    const query = Group.find(filter).sort({ createdAt: -1 });
    if (includeClients) query.populate('clients');
    const groups = await query.exec();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
