const Group = require('../models/Group');

exports.createGroup = async (req, res) => {
  try {
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    const payload = { ...req.body };
    if (user && user.email) payload.createdByEmail = user.email;
    if (restricted && user) {
      payload.branchName = user.branchName;
      payload.branchCode = user.branchCode;
    }
    const group = await Group.create(payload);
    res.status(201).json(group);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllGroups = async (req, res) => {
  try {
    const { branchName, branchCode } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.createdByEmail = user.email;
      if (!branchCode) filter.branchCode = user.branchCode;
    }
    const groups = await Group.find(filter).populate('clients').sort({ createdAt: -1 });
    console.log('[Groups:getAllGroups]', { filter, count: groups.length });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getGroupById = async (req, res) => {
  try {
    const id = req.params.id;
    const group = await Group.findById(id).populate('clients');
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!group.createdByEmail || group.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    console.log('[Groups:getById]', { id, memberCount: group.clients?.length || 0 });
    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateGroup = async (req, res) => {
  try {
    const existing = await Group.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Group not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!existing.createdByEmail || existing.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const payload = { ...req.body };
    if (restricted && user) {
      payload.branchName = user.branchName;
      payload.branchCode = user.branchCode;
      payload.createdByEmail = user.email;
    }
    const group = await Group.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    const existing = await Group.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Group not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!existing.createdByEmail || existing.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const group = await Group.findByIdAndDelete(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ message: 'Group deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
