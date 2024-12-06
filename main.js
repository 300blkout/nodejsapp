const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

const SECRET_KEY = 'secret123'; // Replace with a secure key
const PORT = 80;

// Load staff data
const staff = JSON.parse(fs.readFileSync('staff.json', 'utf8'));

// Load or initialize users
let users = JSON.parse(fs.existsSync('users.json') ? fs.readFileSync('users.json', 'utf8') : '{}');

// Save users to file
const saveUsers = () => fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

app.use(express.static('public'));

// Middleware to authenticate
const authenticater = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).send({ message: 'No token provided' });
  
    try {
      req.user = jwt.verify(token, SECRET_KEY);
      next();
    } catch {
      res.status(401).send({ message: 'Invalid token' });
    }
  };

  
// Signup endpoint
// Signup endpoint
app.post('/signup', (req, res) => {
    const { username, password } = req.body;
  
    if (users[username]) {
      return res.status(400).send({ message: 'User already exists' });
    }
  
    const hashedPassword = bcrypt.hashSync(password, 10);
    users[username] = {
      password: hashedPassword,
      coins: 100, // Start with some initial coins
      inventory: {
        packs: [], // Empty list of packs initially
        cards: [], // Empty collection of cards
        futureItems: {} // Placeholder for future additions
      }
    };
  
    saveUsers();
  
    // Generate a token for auto-login
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
    res.send({ message: 'Signup successful', token });
  });

  // ME endpoint to return user info
app.get('/me', authenticater, (req, res) => {
    const user = users[req.user.username];
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }
    res.send({ username: req.user.username, coins: user.coins });
  });
  

// Load pack data
const packs = JSON.parse(fs.readFileSync('packs.json', 'utf8'));

// Get available packs
app.get('/packs', (req, res) => {
  res.send(packs);
});

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).send({ message: 'Invalid credentials' });
  }

  const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
  res.send({ token });
});

// Middleware to authenticate
const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).send({ message: 'No token provided' });

  try {
    req.user = jwt.verify(token, SECRET_KEY);
    next();
  } catch {
    res.status(401).send({ message: 'Invalid token' });
  }
};

// Play clicking game endpoint
app.post('/play', authenticate, (req, res) => {
  const user = users[req.user.username];
  user.coins += 1;
  saveUsers();
  res.send({ coins: user.coins });
});


// Buy pack and add to inventory
app.post('/buy-pack', authenticate, (req, res) => {
    const { packName } = req.body;
    const user = users[req.user.username];
    const pack = packs.find((p) => p.name === packName);
  
    if (!pack) return res.status(400).send({ message: 'Pack not found' });
    if (user.coins < pack.cost) return res.status(400).send({ message: 'Not enough coins' });
  
    user.coins -= pack.cost;
    user.inventory.packs.push({ name: packName, itemsPerPack: pack.itemsPerPack });
  
    saveUsers();
    res.send({ message: `${packName} added to inventory`, coins: user.coins });
  });
  
// Open a pack from inventory
app.post('/open-pack', authenticate, (req, res) => {
    const { packName } = req.body;
    const user = users[req.user.username];
    const packIndex = user.inventory.packs.findIndex((p) => p.name === packName);
  
    if (packIndex === -1) return res.status(400).send({ message: 'Pack not found in inventory' });
  
    const pack = packs.find((p) => p.name === packName);
    if (!pack) return res.status(400).send({ message: 'Invalid pack name' });
  
    // Generate cards based on rarity chances
    const newCards = Array.from({ length: pack.itemsPerPack }, () => {
      const rarity = selectRarity(pack.rarityChances);
      return { ...staff[Math.floor(Math.random() * staff.length)], rarity };
    });
  
    // Remove the pack from inventory and add cards to collection
    user.inventory.packs.splice(packIndex, 1);
    user.inventory.cards.push(...newCards);
  
    saveUsers();
    res.send({ newCards, message: `${packName} opened` });
  });
  

// Helper function to select a rarity based on chances
const selectRarity = (rarityChances) => {
    const rand = Math.random() * 100;
    let cumulative = 0;
  
    for (const [rarity, chance] of Object.entries(rarityChances)) {
      cumulative += chance;
      if (rand < cumulative) return rarity;
    }
    return 'common'; // Default to common if no match
  };
  

// View collection
// Collection endpoint to return user's inventory (packs and cards)
app.get('/collection', authenticate, (req, res) => {
    const user = users[req.user.username];
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }
  
    const { packs, cards } = user.inventory;
    console.log(packs)
    res.send({ packs, cards });
  });
  
// The trade system
// Trade phases:
// 1) from user creates trade request (phase: "offer", status: "open")
// 2) to user responds:
//    - decline -> status: "declined"
//    - accept as-is -> finalize trade (status: "completed")
//    - counter-offer -> swap items in fromOffer/toOffer, phase: "counter", still "open"
// 3) from user sees counter-offer:
//    - decline -> "declined"
//    - accept final -> finalize items, "completed"

// Helper to check and move items between users
function transferItems(giver, taker, packsToMove, cardsToMove) {
    // Ensure giver has these items
    const giverData = users[giver].inventory;
    const takerData = users[taker].inventory;
  
    // Check and remove from giver
    for (const p of packsToMove) {
      const i = giverData.packs.indexOf(p);
      if (i === -1) return false; // Item not found
      giverData.packs.splice(i, 1);
    }
    for (const c of cardsToMove) {
      const i = giverData.cards.findIndex(card => card.name === c.name);
      // If your cards are just strings, adapt accordingly. If staff objects are needed, ensure you stored them properly.
      if (i === -1) return false; 
      giverData.cards.splice(i, 1);
    }
  
    // Add to taker
    takerData.packs.push(...packsToMove);
    takerData.cards.push(...cardsToMove);
  
    return true;
  }
  
  // Request a trade
  app.post('/trade/request', authenticate, (req, res) => {
    const { to, fromOffer, toOffer } = req.body;
  
    if (!users[to]) return res.status(404).send({ message: 'User to trade with not found' });
    if (!fromOffer || !toOffer) return res.status(400).send({ message: 'Must specify fromOffer and toOffer' });
  
    const trade = {
      id: trades.length ? trades[trades.length - 1].id + 1 : 1,
      from: req.user.username,
      to: to,
      phase: "offer",
      status: "open",
      fromOffer: {
        packs: fromOffer.packs || [],
        cards: fromOffer.cards || []
      },
      toOffer: {
        packs: toOffer.packs || [],
        cards: toOffer.cards || []
      }
    };
  
    trades.push(trade);
    saveTrades();
    res.send({ message: 'Trade request sent', trade });
  });
  
  // View trade requests (incoming and outgoing)
  app.get('/trade/requests', authenticate, (req, res) => {
    const username = req.user.username;
    const incoming = trades.filter(t => t.to === username && t.status === 'open');
    const outgoing = trades.filter(t => t.from === username && t.status === 'open');
    res.send({ incoming, outgoing });
  });
  
  // Respond to a trade (for the "to" user)
  app.post('/trade/respond', authenticate, (req, res) => {
    const { id, action, fromOffer, toOffer } = req.body;
    // action can be: 'decline', 'accept', 'counter'
    const trade = trades.find(t => t.id === id);
    if (!trade) return res.status(404).send({ message: 'Trade not found' });
    if (trade.status !== 'open') return res.status(400).send({ message: 'Trade no longer open' });
  
    // Ensure the user responding is the 'to' user if phase is 'offer', or the 'from' user if phase is 'counter'
    // Actually, let's define:
    // Phase "offer": 'to' user is responding
    // Phase "counter": 'from' user is responding
    const responder = req.user.username;
  
    if (trade.phase === 'offer' && responder !== trade.to) {
      return res.status(403).send({ message: 'You are not authorized to respond now' });
    }
    if (trade.phase === 'counter' && responder !== trade.from) {
      return res.status(403).send({ message: 'You are not authorized to respond now' });
    }
  
    if (action === 'decline') {
      trade.status = 'declined';
      saveTrades();
      return res.send({ message: 'Trade declined' });
    }
  
    if (action === 'accept') {
      // Accept as-is:
      // If phase = 'offer' and 'to' user accepts:
      //   - If we are at 'offer', 'to' user acceptance means they want to finalize right away?
      //   Or do they need a 'counter' phase to finalize?
      // Let's assume:
      //   If phase = 'offer' and to user "accepts", they accept the initial offer, finalize the trade.
      //   If phase = 'counter' and from user "accepts", finalize the trade.
  
      const fromUser = trade.from;
      const toUser = trade.to;
  
      // finalizing means transferring items
      const success1 = transferItems(fromUser, toUser, trade.fromOffer.packs, trade.fromOffer.cards);
      const success2 = transferItems(toUser, fromUser, trade.toOffer.packs, trade.toOffer.cards);
      if (!success1 || !success2) {
        // If transfer fails, restore items or handle error
        // For simplicity, just say trade failed
        return res.status(400).send({ message: 'Trade failed due to inventory mismatch' });
      }
      saveUsers();
  
      trade.status = 'completed';
      saveTrades();
      return res.send({ message: 'Trade completed successfully', trade });
    }
  
    if (action === 'counter') {
      // The responder proposes a counter-offer
      // Swap the phase, and update fromOffer/toOffer
      if (!fromOffer || !toOffer) return res.status(400).send({ message: 'Must provide fromOffer and toOffer for counter' });
  
      trade.fromOffer = {
        packs: fromOffer.packs || [],
        cards: fromOffer.cards || []
      };
      trade.toOffer = {
        packs: toOffer.packs || [],
        cards: toOffer.cards || []
      };
      // Switch the phase
      // After a counter by 'to' user, we go to 'counter' phase and now 'from' user must respond
      // After a counter by 'from' user, we go back to 'offer' phase to get final acceptance from 'to'?
      // Let's keep it simple: 
      // "offer" -> "to" counters -> "counter" phase
      // "counter" -> "from" counters -> "offer" phase
      trade.phase = trade.phase === 'offer' ? 'counter' : 'offer';
  
      saveTrades();
      return res.send({ message: 'Counter-offer made', trade });
    }
  
    res.status(400).send({ message: 'Invalid action' });
  });
// Start the server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
