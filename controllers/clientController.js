const mongoose = require('mongoose');
const Client = require('../models/Client');
const Group = require('../models/Group');
const Counter = require('../models/Counter');

exports.createClient = async (req, res) => {
  try {
    const {
      branchName,
      branchCode,
      groupName,
      groupCode,
      memberName,
      picture,
      memberAge,
      guardianName,
      guarantorName,
      communityAddress,
      phoneNumber,
      memberNumber,
      admissionDate,
      passBookIssuedDate,
      nationalId,
      memberSignature,
      group,
    } = req.body;

    // Resolve optional group if provided
    let groupDoc = null;
    if (group) {
      if (!mongoose.Types.ObjectId.isValid(group)) {
        return res.status(400).json({ error: 'Invalid group id' });
      }
      groupDoc = await Group.findById(group);
      if (!groupDoc) return res.status(404).json({ error: 'Group not found' });
      // Restricted users must own the group
      const user = req.userDoc;
      const role = (user && user.role ? String(user.role).toLowerCase() : '');
      const restricted = role === 'loan officer' || role === 'field agent';
      if (restricted && user) {
        if (!groupDoc.createdByEmail || groupDoc.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden: you do not own this group' });
        }
      }
    }

    // Generate a unique passbook number with retry on duplicate
    let client;
    for (let attempt = 0; attempt < 5; attempt++) {
      const counter = await Counter.findByIdAndUpdate(
        'passbook',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const generatedPassBookNumber = `PB-${String(counter.seq).padStart(6, '0')}`;

      try {
        const user = req.userDoc;
        const role = (user && user.role ? String(user.role).toLowerCase() : '');
        const restricted = role === 'loan officer' || role === 'field agent';
        const payload = {
          passBookNumber: generatedPassBookNumber,
          branchName,
          branchCode,
          groupName: groupName || (groupDoc ? groupDoc.groupName : undefined),
          groupCode: groupCode || (groupDoc ? groupDoc.groupCode : undefined),
          memberName,
          picture,
          memberAge,
          guardianName,
          guarantorName,
          communityAddress,
          phoneNumber,
          memberNumber,
          admissionDate,
          passBookIssuedDate,
          nationalId,
          memberSignature,
          group: groupDoc ? groupDoc._id : undefined,
        };
        if (user && user.email) payload.createdByEmail = user.email;
        if (restricted && user) {
          payload.branchName = user.branchName;
          payload.branchCode = user.branchCode;
        }
        client = await Client.create(payload);
        break; // success
      } catch (e) {
        if (e && e.code === 11000 && /passBookNumber/i.test(e.message || '')) {
          // Duplicate key on passBookNumber, retry
          continue;
        }
        throw e;
      }
    }

    if (!client) {
      return res.status(500).json({ error: 'Failed to allocate passbook number' });
    }

    // Optionally add to group's clients list
    if (groupDoc) {
      try {
        await Group.updateOne({ _id: groupDoc._id }, { $addToSet: { clients: client._id } });
      } catch (e) {
        // Non-fatal; log and continue
        console.warn('[CLIENTS] createClient: failed to push into group.clients', e.message);
      }
    }

    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllClients = async (req, res) => {
  try {
    const { branchName, branchCode, groupId } = req.query;
    const filter = {};
    if (branchName) filter.branchName = branchName;
    if (branchCode) filter.branchCode = branchCode;
    if (groupId) filter.group = groupId;
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      filter.createdByEmail = user.email;
      if (!branchCode) filter.branchCode = user.branchCode;
    }
    const clients = await Client.find(filter).select('-picture').sort({ createdAt: -1 });
    console.log('[Clients:getAllClients]', { filter, count: clients.length });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).select('-picture').populate('group');
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!client.createdByEmail || client.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const updateData = { ...req.body };
    // Prevent passBookNumber from being updated via API
    if (Object.prototype.hasOwnProperty.call(updateData, 'passBookNumber')) {
      delete updateData.passBookNumber;
    }
    // If group provided, validate or ignore empty
    if (Object.prototype.hasOwnProperty.call(updateData, 'group')) {
      if (!updateData.group) {
        delete updateData.group; // ignore empty string/null to avoid cast errors
      } else if (!mongoose.Types.ObjectId.isValid(updateData.group)) {
        return res.status(400).json({ error: 'Invalid group id' });
      }
    }
    const existing = await Client.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!existing.createdByEmail || existing.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      updateData.branchName = user.branchName;
      updateData.branchCode = user.branchCode;
      updateData.createdByEmail = user.email;
    }
    const client = await Client.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const existing = await Client.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      if (!existing.createdByEmail || existing.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClientsByGroup = async (req, res) => {
  try {
    const groupId = req.params.groupId;
    // Access control: ensure restricted users own the group and only see their registered clients
    const user = req.userDoc;
    const role = (user && user.role ? String(user.role).toLowerCase() : '');
    const restricted = role === 'loan officer' || role === 'field agent';
    if (restricted && user) {
      const g = await Group.findById(groupId);
      if (!g) return res.status(404).json({ error: 'Group not found' });
      if (!g.createdByEmail || g.createdByEmail.toLowerCase() !== String(user.email).toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const clients = await Client.find({ group: groupId, createdByEmail: user.email }).select('-picture').sort({ createdAt: -1 });
      console.log('[Clients:getByGroup]', { groupId, count: clients.length });
      return res.json(clients);
    }
    const clients = await Client.find({ group: groupId }).select('-picture').sort({ createdAt: -1 });
    console.log('[Clients:getByGroup]', { groupId, count: clients.length });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Upload client picture using multer (memory storage). Stores as Data URI in `picture`.
exports.uploadClientPicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No picture file uploaded' });
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const mime = req.file.mimetype || 'application/octet-stream';
    const base64 = req.file.buffer.toString('base64');
    client.picture = `data:${mime};base64,${base64}`;
    await client.save();
    res.status(200).json({ message: 'Picture uploaded' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Return raw image bytes for <img src> lazy loading; falls back to 404 if not set
exports.getClientPicture = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).select('picture');
    if (!client || !client.picture) return res.status(404).json({ error: 'Picture not found' });

    // Expect Data URI: data:<mime>;base64,<data>
    const [meta, data] = String(client.picture).split(',');
    const match = /^data:(.*);base64$/.exec(meta || '');
    const mime = (match && match[1]) || 'application/octet-stream';
    const buf = Buffer.from(data || '', 'base64');
    res.set('Content-Type', mime);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
