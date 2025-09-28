const Group = require('../models/Group');
const Counter = require('../models/Counter');

exports.createGroup = async (req, res) => {
  try {
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    const base = { ...req.body };
    // Never trust incoming groupCode; it will be auto-generated
    if (Object.prototype.hasOwnProperty.call(base, 'groupCode')) delete base.groupCode;
    // Sanitize optional refs
    if (Object.prototype.hasOwnProperty.call(base, 'community') && !base.community) {
      delete base.community;
    }
    if (user && user.email) base.createdByEmail = user.email;
    if (restricted && user) {
      base.branchName = user.branchName;
      base.branchCode = user.branchCode;
    }

    // Generate unique group code using Counter with retry
    let created;
    for (let attempt = 0; attempt < 5; attempt++) {
      const counter = await Counter.findByIdAndUpdate(
        'group',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const generatedCode = `GRP-${String(counter.seq).padStart(6, '0')}`;
      try {
        created = await Group.create({ ...base, groupCode: generatedCode });
        break;
      } catch (e) {
        if (e && e.code === 11000 && /groupCode/i.test(e.message || '')) {
          // Duplicate collision, retry
          continue;
        }
        throw e;
      }
    }

    if (!created) return res.status(500).json({ error: 'Failed to allocate group code' });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllGroups = async (req, res) => {
  try {
    const { branchName, branchCode, community, communityId } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    const commId = community || communityId;
    if (commId) filter.community = commId;
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.createdByEmail = user.email;
      if (!branchCode) filter.branchCode = user.branchCode;
    }
    const groups = await Group.find(filter)
      .populate('clients')
      .populate('community')
      .populate('loanOfficer')
      .sort({ createdAt: -1 });
    console.log('[Groups:getAllGroups]', { filter, count: groups.length });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getGroupById = async (req, res) => {
  try {
    const id = req.params.id;
    const group = await Group.findById(id)
      .populate('clients')
      .populate('community')
      .populate('loanOfficer');
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
    // Sanitize optional refs
    if (Object.prototype.hasOwnProperty.call(payload, 'community') && !payload.community) {
      delete payload.community;
    }
    // Prevent updates to groupCode
    if (Object.prototype.hasOwnProperty.call(payload, 'groupCode')) {
      delete payload.groupCode;
    }
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
