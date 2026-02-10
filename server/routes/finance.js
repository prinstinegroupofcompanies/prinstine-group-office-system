const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { createNotification, sendNotificationToRole } = require('../utils/notifications');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/finance');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Emails with explicit finance access (e.g. Assistant Finance Officer)
const FINANCE_EMAILS = ['sean@prinstinegroup.org'];

// Helper function to check if user is Finance staff (Assistant Finance Officer, Finance Department Head, or Admin)
async function isFinanceStaff(user) {
  if (!user) return false;
  const email = (user.email || '').toLowerCase().trim();
  if (user.role === 'Admin' || FINANCE_EMAILS.includes(email)) return true;
  if (user.role === 'DepartmentHead') {
    const dept = await db.get(
      'SELECT name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
      [user.id, email]
    );
    return dept && dept.name.toLowerCase().includes('finance');
  }
  // Assistant Finance Officer - Staff role with Finance department access
  const staff = await db.get('SELECT department FROM staff WHERE user_id = ?', [user.id]);
  return staff && staff.department && staff.department.toLowerCase().includes('finance');
}

// Helper function to check if user can manage petty cash (view/edit)
async function canManagePettyCash(user) {
  return await isFinanceStaff(user);
}

// Helper function to check if user can manage assets (view/edit/delete)
async function canManageAssets(user) {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  return await isFinanceStaff(user);
}

// Helper function to check if user can delete petty cash (Assistant Finance Officer and Finance Department Head only)
async function canDeletePettyCash(user) {
  if (user.role === 'Admin') return false; // Admin cannot delete
  return await isFinanceStaff(user); // Only Assistant Finance Officer and Finance Department Head
}

// Helper function to check if user is Assistant Finance Officer (Staff in Finance)
async function isAssistantFinanceOfficer(user) {
  if (user.role === 'Staff') {
    const staff = await db.get('SELECT department FROM staff WHERE user_id = ?', [user.id]);
    return staff && staff.department && staff.department.toLowerCase().includes('finance');
  }
  return false;
}

// Helper function to check if user is Finance Department Head
async function isFinanceDepartmentHead(user) {
  if (user.role === 'DepartmentHead') {
    const dept = await db.get(
      'SELECT name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
      [user.id, user.email.toLowerCase().trim()]
    );
    return dept && dept.name.toLowerCase().includes('finance');
  }
  return false;
}

// Helper function to generate Petty Cash Slip Number
function generatePettyCashSlipNo(year, month) {
  const monthStr = String(month).padStart(2, '0');
  return `PC-${year}-${monthStr}-001`; // Sequential will be handled per ledger
}

// Helper function to get month name
const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                'July', 'August', 'September', 'October', 'November', 'December'];

// Helper function to generate Asset ID
function generateAssetId(category) {
  const categoryCode = category.substring(0, 2).toUpperCase();
  const timestamp = Date.now().toString().slice(-6);
  return `A${timestamp}-${categoryCode}-01`;
}

// ==========================================
// PETTY CASH ROUTES (Simplified - No Approval Flow)
// ==========================================

// Get all petty cash entries (Assistant Finance Officer, Finance Department Head, and Admin can see each other's history)
router.get('/petty-cash', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    
    // Check if user has access
    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied. Only Finance staff and Admin can view petty cash.' });
    }
    
    let query = `
      SELECT pct.*,
             pcl.month, pcl.year,
             cust.name as custodian_name,
             cust_staff.staff_id as custodian_staff_id,
             creator.name as created_by_name
      FROM petty_cash_transactions pct
      JOIN petty_cash_ledgers pcl ON pct.ledger_id = pcl.id
      LEFT JOIN staff cust_staff ON pcl.petty_cash_custodian_id = cust_staff.id
      LEFT JOIN users cust ON cust_staff.user_id = cust.id
      LEFT JOIN users cust_direct ON pcl.petty_cash_custodian_id = cust_direct.id AND cust_staff.id IS NULL
      LEFT JOIN users creator ON pct.approved_by_id = creator.id
      WHERE 1=1
    `;
    const params = [];

    // Date range filter
    if (from_date) {
      query += ' AND DATE(pct.transaction_date) >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND DATE(pct.transaction_date) <= ?';
      params.push(to_date);
    }

    query += ' ORDER BY pct.transaction_date DESC, pct.id DESC';

    const transactions = await db.all(query, params);

    // Calculate Period, Total Deposited, Total Withdrawn, Closing Balance
    const summary = transactions.reduce((acc, t) => {
      acc.total_deposited += parseFloat(t.amount_deposited || 0);
      acc.total_withdrawn += parseFloat(t.amount_withdrawn || 0);
      return acc;
    }, { total_deposited: 0, total_withdrawn: 0 });

    // Group by period (month/year)
    const byPeriod = {};
    transactions.forEach(t => {
      const period = `${months[t.month - 1]} ${t.year}`;
      if (!byPeriod[period]) {
        byPeriod[period] = {
          period,
          transactions: [],
          total_deposited: 0,
          total_withdrawn: 0,
          starting_balance: 0,
          closing_balance: 0
        };
      }
      byPeriod[period].transactions.push(t);
      byPeriod[period].total_deposited += parseFloat(t.amount_deposited || 0);
      byPeriod[period].total_withdrawn += parseFloat(t.amount_withdrawn || 0);
    });

    // Calculate closing balance for each period
    // Note: This is simplified - for production, consider async/await or pre-fetching ledger data
    for (const period of Object.values(byPeriod)) {
      const ledger = transactions.find(t => `${months[t.month - 1]} ${t.year}` === period.period);
      if (ledger) {
        try {
          const ledgerData = await db.get(
            'SELECT starting_balance FROM petty_cash_ledgers WHERE year = ? AND month = ?',
            [ledger.year, ledger.month]
          );
          period.starting_balance = ledgerData?.starting_balance || 0;
        } catch (err) {
          console.error('Error fetching ledger data for period:', err);
          period.starting_balance = 0;
        }
      }
      period.closing_balance = period.starting_balance + period.total_deposited - period.total_withdrawn;
    }

    res.json({ 
      transactions,
      summary: {
        ...summary,
        closing_balance: summary.total_deposited - summary.total_withdrawn
      },
      by_period: Object.values(byPeriod)
    });
  } catch (error) {
    console.error('Get petty cash error:', error);
    res.status(500).json({ error: 'Failed to fetch petty cash: ' + error.message });
  }
});

// Get all staff and department heads for custodian selection
router.get('/petty-cash/custodians', authenticateToken, async (req, res) => {
  try {
    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all staff
    const staff = await db.all(`
      SELECT s.id, s.staff_id, u.id as user_id, u.name, u.email, 'Staff' as role_type
      FROM staff s
      JOIN users u ON s.user_id = u.id
      WHERE u.is_active = 1
      ORDER BY u.name
    `);

    // Get all department heads
    const deptHeads = await db.all(`
      SELECT d.manager_id as id, u.id as user_id, u.name, u.email, 'DepartmentHead' as role_type
      FROM departments d
      JOIN users u ON d.manager_id = u.id
      WHERE u.is_active = 1
      GROUP BY d.manager_id, u.id, u.name, u.email
      ORDER BY u.name
    `);

    // Combine and format
    const custodians = [
      ...staff.map(s => ({
        id: s.id,
        user_id: s.user_id,
        name: s.name,
        email: s.email,
        staff_id: s.staff_id,
        role_type: s.role_type
      })),
      ...deptHeads.map(d => ({
        id: d.id,
        user_id: d.user_id,
        name: d.name,
        email: d.email,
        role_type: d.role_type
      }))
    ];

    res.json({ custodians });
  } catch (error) {
    console.error('Get custodians error:', error);
    res.status(500).json({ error: 'Failed to fetch custodians' });
  }
});

// Create petty cash entry (simplified - no approval flow)
router.post('/petty-cash', authenticateToken, [
  body('transaction_date')
    .notEmpty().withMessage('Transaction date is required')
    .custom((value) => {
      // Accept ISO8601 format or datetime-local format (YYYY-MM-DDTHH:mm)
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid transaction date format');
      }
      return true;
    }),
  body('petty_cash_custodian_id').notEmpty().withMessage('Petty cash custodian is required'),
  body('amount_deposit').optional().isFloat({ min: 0 }).withMessage('Amount deposit must be a non-negative number'),
  body('amount_withdrawal').optional().isFloat({ min: 0 }).withMessage('Amount withdrawal must be a non-negative number'),
  body('description').optional().trim(),
  body('charged_to').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        errors: errors.array() 
      });
    }

    // Check access
    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied. Only Finance staff and Admin can create petty cash entries.' });
    }

    const { 
      transaction_date, 
      petty_cash_custodian_id, 
      amount_deposit = 0, 
      amount_withdrawal = 0,
      description = '',
      charged_to = ''
    } = req.body;

    // Validate transaction date
    if (!transaction_date) {
      return res.status(400).json({ error: 'Transaction date is required' });
    }

    const transDate = new Date(transaction_date);
    if (isNaN(transDate.getTime())) {
      return res.status(400).json({ error: 'Invalid transaction date format' });
    }

    // Validate that at least one amount is provided
    const deposit = parseFloat(amount_deposit) || 0;
    const withdrawal = parseFloat(amount_withdrawal) || 0;
    
    if (deposit === 0 && withdrawal === 0) {
      return res.status(400).json({ error: 'Either deposit or withdrawal amount is required' });
    }
    if (deposit > 0 && withdrawal > 0) {
      return res.status(400).json({ error: 'Cannot have both deposit and withdrawal in the same transaction' });
    }
    if (deposit < 0 || withdrawal < 0) {
      return res.status(400).json({ error: 'Amounts cannot be negative' });
    }

    // Validate custodian - can be staff or department head
    if (!petty_cash_custodian_id) {
      return res.status(400).json({ error: 'Petty cash custodian is required' });
    }

    let custodianUser = null;
    try {
      const staff = await db.get('SELECT user_id FROM staff WHERE id = ? OR user_id = ?', [petty_cash_custodian_id, petty_cash_custodian_id]);
      if (staff) {
        custodianUser = await db.get('SELECT id FROM users WHERE id = ? AND is_active = 1', [staff.user_id]);
      } else {
        custodianUser = await db.get('SELECT id FROM users WHERE id = ? AND (role = ? OR role = ?) AND is_active = 1', 
          [petty_cash_custodian_id, 'DepartmentHead', 'Admin']);
      }
    } catch (dbError) {
      console.error('Error validating custodian:', dbError);
      return res.status(500).json({ error: 'Failed to validate custodian' });
    }

    if (!custodianUser) {
      return res.status(400).json({ error: 'Invalid custodian. Must be a valid active staff member or department head.' });
    }

    // Get or create ledger for the month/year of transaction
    const month = transDate.getMonth() + 1;
    const year = transDate.getFullYear();

    let ledger = await db.get(
      'SELECT * FROM petty_cash_ledgers WHERE year = ? AND month = ?',
      [year, month]
    );

    if (!ledger) {
      // Create new ledger for this month/year
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevLedger = await db.get(
        'SELECT id FROM petty_cash_ledgers WHERE year = ? AND month = ?',
        [prevYear, prevMonth]
      );
      
      let startingBalance = 0;
      if (prevLedger) {
        const prevTransactions = await db.all(
          'SELECT amount_deposited, amount_withdrawn FROM petty_cash_transactions WHERE ledger_id = ?',
          [prevLedger.id]
        );
        const prevLedgerData = await db.get(
          'SELECT starting_balance FROM petty_cash_ledgers WHERE id = ?',
          [prevLedger.id]
        );
        const prevDeposited = prevTransactions.reduce((sum, t) => sum + (parseFloat(t.amount_deposited) || 0), 0);
        const prevWithdrawn = prevTransactions.reduce((sum, t) => sum + (parseFloat(t.amount_withdrawn) || 0), 0);
        startingBalance = (prevLedgerData?.starting_balance || 0) + prevDeposited - prevWithdrawn;
      }

      const ledgerResult = await db.run(
        `INSERT INTO petty_cash_ledgers 
         (month, year, starting_balance, petty_cash_custodian_id, created_by, approval_status)
         VALUES (?, ?, ?, ?, ?, 'Approved')`,
        [month, year, startingBalance, petty_cash_custodian_id, req.user.id]
      );
      
      ledger = await db.get('SELECT * FROM petty_cash_ledgers WHERE id = ?', [ledgerResult.lastID]);
    }

    // Get last transaction balance for this ledger
    const lastTransaction = await db.get(
      'SELECT balance FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1',
      [ledger.id]
    );
    const previousBalance = lastTransaction ? lastTransaction.balance : ledger.starting_balance;
    const newBalance = previousBalance + deposit - withdrawal;

    // Generate slip number
    const transactionCount = await db.get(
      'SELECT COUNT(*) as count FROM petty_cash_transactions WHERE ledger_id = ?',
      [ledger.id]
    );
    const slipNo = `PC-${ledger.year}-${String(ledger.month).padStart(2, '0')}-${String((transactionCount.count || 0) + 1).padStart(3, '0')}`;

    // Create transaction
    const result = await db.run(
      `INSERT INTO petty_cash_transactions 
       (ledger_id, transaction_date, petty_cash_slip_no, description, amount_deposited, 
        amount_withdrawn, balance, charged_to, approved_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ledger.id, transaction_date, slipNo, description || 'Petty cash transaction', 
       deposit, withdrawal, newBalance, charged_to || null, req.user.id]
    );

    await logAction(req.user.id, 'create_petty_cash', 'finance', result.lastID, { 
      ledger_id: ledger.id, 
      amount_deposit: deposit, 
      amount_withdrawal: withdrawal 
    }, req);

    // Calculate totals for ledger
    const allTransactions = await db.all(
      'SELECT amount_deposited, amount_withdrawn FROM petty_cash_transactions WHERE ledger_id = ?',
      [ledger.id]
    );
    const totalDeposited = allTransactions.reduce((sum, t) => sum + (parseFloat(t.amount_deposited) || 0), 0);
    const totalWithdrawn = allTransactions.reduce((sum, t) => sum + (parseFloat(t.amount_withdrawn) || 0), 0);
    const closingBalance = ledger.starting_balance + totalDeposited - totalWithdrawn;

    // Emit real-time event
    if (global.io) {
      global.io.emit('petty_cash_created', {
        id: result.lastID,
        ledger_id: ledger.id,
        transaction_date,
        custodian_id: petty_cash_custodian_id,
        amount_deposit: deposit,
        amount_withdrawal: withdrawal,
        balance: newBalance,
        period: `${months[month - 1]} ${year}`,
        total_deposited: totalDeposited,
        total_withdrawn: totalWithdrawn,
        closing_balance: closingBalance,
        created_by: req.user.id
      });
    }

    res.status(201).json({
      message: 'Petty cash entry created successfully',
      transaction: { 
        id: result.lastID, 
        balance: newBalance, 
        slip_no: slipNo,
        period: `${months[month - 1]} ${year}`,
        total_deposited: totalDeposited,
        total_withdrawn: totalWithdrawn,
        closing_balance: closingBalance
      }
    });
  } catch (error) {
    console.error('Create petty cash error:', error);
    res.status(500).json({ error: 'Failed to create petty cash entry: ' + error.message });
  }
});

    // Update petty cash entry (Assistant Finance Officer, Finance Department Head, and Admin)
router.put('/petty-cash/:id', authenticateToken, [
  body('transaction_date')
    .optional()
    .custom((value) => {
      if (!value) return true; // Optional, so empty is OK
      // Accept ISO8601 format or datetime-local format (YYYY-MM-DDTHH:mm)
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid transaction date format');
      }
      return true;
    }),
  body('amount_deposit').optional().isFloat({ min: 0 }).withMessage('Amount deposit must be a non-negative number'),
  body('amount_withdrawal').optional().isFloat({ min: 0 }).withMessage('Amount withdrawal must be a non-negative number'),
  body('description').optional().trim(),
  body('charged_to').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        errors: errors.array() 
      });
    }

    // Check access
    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied. Only Finance staff and Admin can update petty cash entries.' });
    }

    if (!req.params.id || isNaN(parseInt(req.params.id))) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const transaction = await db.get(
      'SELECT * FROM petty_cash_transactions WHERE id = ?',
      [req.params.id]
    );

    if (!transaction) {
      return res.status(404).json({ error: 'Petty cash entry not found' });
    }

    const updates = req.body;
    const updateFields = [];
    const params = [];

    // Validate transaction date if provided
    if (updates.transaction_date) {
      const transDate = new Date(updates.transaction_date);
      if (isNaN(transDate.getTime())) {
        return res.status(400).json({ error: 'Invalid transaction date format' });
      }
      updateFields.push('transaction_date = ?');
      params.push(updates.transaction_date);
    }

    // Validate amounts - ensure both are not provided
    const deposit = updates.amount_deposit !== undefined ? parseFloat(updates.amount_deposit) || 0 : undefined;
    const withdrawal = updates.amount_withdrawal !== undefined ? parseFloat(updates.amount_withdrawal) || 0 : undefined;
    
    if (deposit !== undefined && deposit < 0) {
      return res.status(400).json({ error: 'Amount deposit cannot be negative' });
    }
    if (withdrawal !== undefined && withdrawal < 0) {
      return res.status(400).json({ error: 'Amount withdrawal cannot be negative' });
    }

    // Get existing amounts
    const existingDeposit = parseFloat(transaction.amount_deposited) || 0;
    const existingWithdrawal = parseFloat(transaction.amount_withdrawn) || 0;
    
    // Determine final values
    const finalDeposit = deposit !== undefined ? deposit : existingDeposit;
    const finalWithdrawal = withdrawal !== undefined ? withdrawal : existingWithdrawal;
    
    // Check if both are provided and both are > 0
    if (finalDeposit > 0 && finalWithdrawal > 0) {
      return res.status(400).json({ error: 'Cannot have both deposit and withdrawal in the same transaction' });
    }
    // Check if both are zero
    if (finalDeposit === 0 && finalWithdrawal === 0) {
      return res.status(400).json({ error: 'Either deposit or withdrawal amount must be greater than zero' });
    }

    if (updates.amount_deposit !== undefined) {
      updateFields.push('amount_deposited = ?');
      params.push(deposit);
    }
    if (updates.amount_withdrawal !== undefined) {
      updateFields.push('amount_withdrawn = ?');
      params.push(withdrawal);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.charged_to !== undefined) {
      updateFields.push('charged_to = ?');
      params.push(updates.charged_to);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
    await db.run(
      `UPDATE petty_cash_transactions 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params
    );

    // Recalculate balances for all transactions in this ledger
    const ledger = await db.get('SELECT * FROM petty_cash_ledgers WHERE id = ?', [transaction.ledger_id]);
    if (!ledger) {
      return res.status(404).json({ error: 'Ledger not found for this transaction' });
    }

    const allTransactions = await db.all(
      'SELECT * FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date, id',
      [transaction.ledger_id]
    );

    let runningBalance = ledger.starting_balance || 0;
    for (const t of allTransactions) {
      runningBalance = runningBalance + (parseFloat(t.amount_deposited) || 0) - (parseFloat(t.amount_withdrawn) || 0);
      await db.run('UPDATE petty_cash_transactions SET balance = ? WHERE id = ?', [runningBalance, t.id]);
    }

    await logAction(req.user.id, 'update_petty_cash', 'finance', req.params.id, updates, req);

    // Emit real-time event
    if (global.io) {
      global.io.emit('petty_cash_updated', {
        id: req.params.id,
        ledger_id: transaction.ledger_id,
        ...updates,
        updated_by: req.user.id
      });
    }

    res.json({ message: 'Petty cash entry updated successfully' });
  } catch (error) {
    console.error('Update petty cash error:', error);
    res.status(500).json({ error: 'Failed to update petty cash entry: ' + error.message });
  }
});

// Reset all petty cash balances (Admin only - for fresh start)
router.post('/petty-cash/reset-all-balances', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    // Reset all transaction balances to 0
    await db.run('UPDATE petty_cash_transactions SET balance = 0');
    
    // Reset all ledger starting balances to 0
    await db.run('UPDATE petty_cash_ledgers SET starting_balance = 0');
    
    // Recalculate balances from scratch starting from 0
    const ledgers = await db.all('SELECT id FROM petty_cash_ledgers ORDER BY year, month');
    
    for (const ledger of ledgers) {
      const transactions = await db.all(
        'SELECT * FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date, id',
        [ledger.id]
      );
      
      let runningBalance = 0; // Start fresh from 0
      for (const t of transactions) {
        runningBalance = runningBalance + (parseFloat(t.amount_deposited) || 0) - (parseFloat(t.amount_withdrawn) || 0);
        await db.run('UPDATE petty_cash_transactions SET balance = ? WHERE id = ?', [runningBalance, t.id]);
      }
      
      // Update ledger starting balance to 0
      await db.run('UPDATE petty_cash_ledgers SET starting_balance = 0 WHERE id = ?', [ledger.id]);
    }
    
    await logAction(req.user.id, 'reset_all_petty_cash_balances', 'finance', null, {}, req);
    
    res.json({ message: 'All petty cash balances have been reset to zero and recalculated from scratch' });
  } catch (error) {
    console.error('Reset petty cash balances error:', error);
    res.status(500).json({ error: 'Failed to reset balances: ' + error.message });
  }
});

// Delete petty cash entry (Assistant Finance Officer and Finance Department Head only)
router.delete('/petty-cash/:id', authenticateToken, async (req, res) => {
  try {
    // Check delete permission
    if (!(await canDeletePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied. Only Assistant Finance Officer and Finance Department Head can delete petty cash entries.' });
    }

    const transaction = await db.get(
      'SELECT * FROM petty_cash_transactions WHERE id = ?',
      [req.params.id]
    );

    if (!transaction) {
      return res.status(404).json({ error: 'Petty cash entry not found' });
    }

    // Delete the transaction
    await db.run('DELETE FROM petty_cash_transactions WHERE id = ?', [req.params.id]);

    // Recalculate balances for remaining transactions in this ledger
    const ledger = await db.get('SELECT * FROM petty_cash_ledgers WHERE id = ?', [transaction.ledger_id]);
    if (!ledger) {
      return res.status(404).json({ error: 'Ledger not found for this transaction' });
    }

    const allTransactions = await db.all(
      'SELECT * FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date, id',
      [transaction.ledger_id]
    );

    // If no transactions remain, reset starting balance to 0
    if (allTransactions.length === 0) {
      await db.run('UPDATE petty_cash_ledgers SET starting_balance = 0 WHERE id = ?', [transaction.ledger_id]);
      console.log(`[PettyCash] Reset starting balance to 0 for ledger ${transaction.ledger_id} after deleting all transactions`);
    } else {
      // Recalculate balances for remaining transactions
      let runningBalance = ledger.starting_balance || 0;
      for (const t of allTransactions) {
        runningBalance = runningBalance + (parseFloat(t.amount_deposited) || 0) - (parseFloat(t.amount_withdrawn) || 0);
        await db.run('UPDATE petty_cash_transactions SET balance = ? WHERE id = ?', [runningBalance, t.id]);
      }
    }

    await logAction(req.user.id, 'delete_petty_cash', 'finance', req.params.id, {}, req);

    // Emit real-time event
    if (global.io) {
      global.io.emit('petty_cash_deleted', {
        id: req.params.id,
        ledger_id: transaction.ledger_id,
        deleted_by: req.user.id
      });
    }

    res.json({ message: 'Petty cash entry deleted successfully' });
  } catch (error) {
    console.error('Delete petty cash error:', error);
    res.status(500).json({ error: 'Failed to delete petty cash entry: ' + error.message });
  }
});

// ==========================================
// LEGACY PETTY CASH LEDGER ROUTES (Keep for backward compatibility)
// ==========================================

// Get all petty cash ledgers (Assistant Finance Officer, Finance Department Head, and Admin can see each other's history)
router.get('/petty-cash/ledgers', authenticateToken, async (req, res) => {
  try {
    const { year, month, status, from_date, to_date } = req.query;
    
    // Check if user has access
    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied. Only Finance staff and Admin can view petty cash.' });
    }
    
    let query = `
      SELECT pcl.*,
             cust.name as custodian_name, cust_staff.staff_id as custodian_staff_id,
             creator.name as created_by_name
      FROM petty_cash_ledgers pcl
      LEFT JOIN staff cust_staff ON pcl.petty_cash_custodian_id = cust_staff.id
      LEFT JOIN users cust ON cust_staff.user_id = cust.id
      LEFT JOIN users cust_direct ON pcl.petty_cash_custodian_id = cust_direct.id AND cust_staff.id IS NULL
      LEFT JOIN users creator ON pcl.created_by = creator.id
      WHERE 1=1
    `;
    const params = [];

    // Date range filter
    if (from_date) {
      query += ' AND DATE(pcl.created_at) >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND DATE(pcl.created_at) <= ?';
      params.push(to_date);
    }

    if (year) {
      query += ' AND pcl.year = ?';
      params.push(year);
    }
    if (month) {
      query += ' AND pcl.month = ?';
      params.push(month);
    }
    if (status) {
      query += ' AND pcl.approval_status = ?';
      params.push(status);
    }

    query += ' ORDER BY pcl.created_at DESC, pcl.year DESC, pcl.month DESC';

    const ledgers = await db.all(query, params);

    // Calculate totals for each ledger (Period, Total Deposited, Total Withdrawn, Closing Balance)
    for (const ledger of ledgers) {
      // Determine period from date_from and date_to, or from month/year
      if (ledger.date_from && ledger.date_to) {
        ledger.period = `${new Date(ledger.date_from).toLocaleDateString()} - ${new Date(ledger.date_to).toLocaleDateString()}`;
      } else {
        ledger.period = `${months[ledger.month - 1]} ${ledger.year}`;
      }
      
      // Get all transactions for this ledger
      const transactions = await db.all(
        'SELECT amount_deposited, amount_withdrawn, transaction_date FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date, id',
        [ledger.id]
      );
      
      ledger.total_deposited = transactions.reduce((sum, t) => sum + (parseFloat(t.amount_deposited) || 0), 0);
      ledger.total_withdrawn = transactions.reduce((sum, t) => sum + (parseFloat(t.amount_withdrawn) || 0), 0);
      ledger.closing_balance = ledger.starting_balance + ledger.total_deposited - ledger.total_withdrawn;
    }

    res.json({ ledgers });
  } catch (error) {
    console.error('Get petty cash ledgers error:', error);
    res.status(500).json({ error: 'Failed to fetch petty cash ledgers: ' + error.message });
  }
});

// Get single petty cash ledger with transactions
router.get('/petty-cash/ledgers/:id', authenticateToken, async (req, res) => {
  try {
    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ledger = await db.get(
      `SELECT pcl.*,
              COALESCE(cust.name, cust_direct.name) as custodian_name, 
              cust_staff.staff_id as custodian_staff_id,
              approver.name as approved_by_name
       FROM petty_cash_ledgers pcl
       LEFT JOIN staff cust_staff ON pcl.petty_cash_custodian_id = cust_staff.id
       LEFT JOIN users cust ON cust_staff.user_id = cust.id
       LEFT JOIN users cust_direct ON pcl.petty_cash_custodian_id = cust_direct.id AND cust_staff.id IS NULL
       LEFT JOIN users approver ON pcl.approved_by_id = approver.id
       WHERE pcl.id = ?`,
      [req.params.id]
    );

    if (!ledger) {
      return res.status(404).json({ error: 'Ledger not found' });
    }

    const transactions = await db.all(
      `SELECT t.*,
              receiver.name as received_by_name,
              approver.name as approved_by_name
       FROM petty_cash_transactions t
       LEFT JOIN staff receiver_staff ON t.received_by_staff_id = receiver_staff.id
       LEFT JOIN users receiver ON receiver_staff.user_id = receiver.id
       LEFT JOIN users approver ON t.approved_by_id = approver.id
       WHERE t.ledger_id = ?
       ORDER BY t.transaction_date, t.id`,
      [req.params.id]
    );

    const totals = transactions.reduce((acc, t) => {
      acc.deposited += parseFloat(t.amount_deposited || 0);
      acc.withdrawn += parseFloat(t.amount_withdrawn || 0);
      return acc;
    }, { deposited: 0, withdrawn: 0 });

    // Determine period
    if (ledger.date_from && ledger.date_to) {
      ledger.period = `${new Date(ledger.date_from).toLocaleDateString()} - ${new Date(ledger.date_to).toLocaleDateString()}`;
    } else {
      ledger.period = `${months[ledger.month - 1]} ${ledger.year}`;
    }

    ledger.transactions = transactions;
    ledger.total_deposited = totals.deposited;
    ledger.total_withdrawn = totals.withdrawn;
    ledger.closing_balance = ledger.starting_balance + totals.deposited - totals.withdrawn;

    res.json({ ledger });
  } catch (error) {
    console.error('Get petty cash ledger error:', error);
    res.status(500).json({ error: 'Failed to fetch petty cash ledger' });
  }
});

// Create petty cash ledger (Legacy - kept for backward compatibility)
router.post('/petty-cash/ledgers', authenticateToken, [
  body('month').isInt({ min: 1, max: 12 }).withMessage('Month must be 1-12'),
  body('year').isInt({ min: 2020, max: 2100 }).withMessage('Year must be valid'),
  body('starting_balance').isFloat({ min: 0 }).withMessage('Starting balance must be >= 0'),
  body('petty_cash_custodian_id').isInt().withMessage('Petty cash custodian is required'),
  body('date_from').optional().isISO8601().withMessage('Valid date_from is required'),
  body('date_to').optional().isISO8601().withMessage('Valid date_to is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Only Finance staff can create ledgers' });
    }

    const { month, year, starting_balance, petty_cash_custodian_id, date_from, date_to } = req.body;

    // Validate custodian exists (can be staff, dept head, or admin user)
    let custodianExists = false;
    const staff = await db.get('SELECT id, user_id FROM staff WHERE id = ?', [petty_cash_custodian_id]);
    if (staff) {
      custodianExists = true;
    } else {
      const user = await db.get('SELECT id FROM users WHERE id = ?', [petty_cash_custodian_id]);
      if (user) {
        custodianExists = true;
      }
    }
    
    if (!custodianExists) {
      return res.status(400).json({ error: 'Invalid petty cash custodian. Must be a valid staff member, department head, or admin user.' });
    }

    // Check if ledger already exists for this month/year
    const existing = await db.get(
      'SELECT id FROM petty_cash_ledgers WHERE year = ? AND month = ?',
      [year, month]
    );
    if (existing) {
      return res.status(400).json({ error: `Ledger already exists for ${month}/${year}` });
    }

    // Get previous month's closing balance if not provided
    let actualStartingBalance = starting_balance;
    if (!starting_balance || starting_balance === 0) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevLedger = await db.get(
        'SELECT id FROM petty_cash_ledgers WHERE year = ? AND month = ?',
        [prevYear, prevMonth]
      );
      if (prevLedger) {
        const prevTransactions = await db.all(
          'SELECT amount_deposited, amount_withdrawn FROM petty_cash_transactions WHERE ledger_id = ?',
          [prevLedger.id]
        );
        const prevLedgerData = await db.get(
          'SELECT starting_balance FROM petty_cash_ledgers WHERE id = ?',
          [prevLedger.id]
        );
        const prevDeposited = prevTransactions.reduce((sum, t) => sum + (t.amount_deposited || 0), 0);
        const prevWithdrawn = prevTransactions.reduce((sum, t) => sum + (t.amount_withdrawn || 0), 0);
        actualStartingBalance = prevLedgerData.starting_balance + prevDeposited - prevWithdrawn;
      }
    }

    // No approval flow - set status directly to 'Approved'
    const insertColumns = ['month', 'year', 'starting_balance', 'petty_cash_custodian_id', 'created_by', 'approval_status'];
    const insertValues = [month, year, actualStartingBalance, petty_cash_custodian_id, req.user.id, 'Approved'];
    
    if (date_from) {
      insertColumns.push('date_from');
      insertValues.push(date_from);
    }
    if (date_to) {
      insertColumns.push('date_to');
      insertValues.push(date_to);
    }
    
    const placeholders = insertColumns.map(() => '?').join(', ');
    const result = await db.run(
              `INSERT INTO petty_cash_ledgers 
       (${insertColumns.join(', ')})
       VALUES (${placeholders})`,
      insertValues
    );

    await logAction(req.user.id, 'create_petty_cash_ledger', 'finance', result.lastID, { month, year }, req);

    res.status(201).json({
      message: 'Petty cash ledger created successfully',
      ledger: { id: result.lastID, month, year, starting_balance: actualStartingBalance }
    });
  } catch (error) {
    console.error('Create petty cash ledger error:', error);
    res.status(500).json({ error: 'Failed to create petty cash ledger: ' + error.message });
  }
});

// Add transaction to petty cash ledger (Updated)
router.post('/petty-cash/ledgers/:id/transactions', authenticateToken, upload.single('attachment'), [
  body('transaction_date').isISO8601().withMessage('Valid transaction date required'),
  body('description').optional().trim(),
  body('charged_to').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ledger = await db.get('SELECT * FROM petty_cash_ledgers WHERE id = ?', [req.params.id]);
    if (!ledger) {
      return res.status(404).json({ error: 'Ledger not found' });
    }

    const {
      transaction_date, description, amount_deposited, amount_withdrawn,
      charged_to, received_by_type, received_by_staff_id, received_by_name
    } = req.body;

    const deposited = parseFloat(amount_deposited || 0);
    const withdrawn = parseFloat(amount_withdrawn || 0);

    if (deposited > 0 && withdrawn > 0) {
      return res.status(400).json({ error: 'Cannot have both deposit and withdrawal in same transaction' });
    }
    if (deposited === 0 && withdrawn === 0) {
      return res.status(400).json({ error: 'Either deposit or withdrawal amount is required' });
    }

    // Get last transaction balance
    const lastTransaction = await db.get(
      'SELECT balance FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1',
      [req.params.id]
    );
    const previousBalance = lastTransaction ? lastTransaction.balance : ledger.starting_balance;
    const newBalance = previousBalance + deposited - withdrawn;

    // Generate slip number
    const transactionCount = await db.get(
      'SELECT COUNT(*) as count FROM petty_cash_transactions WHERE ledger_id = ?',
      [req.params.id]
    );
    const slipNo = `PC-${ledger.year}-${String(ledger.month).padStart(2, '0')}-${String((transactionCount.count || 0) + 1).padStart(3, '0')}`;

    const attachmentPath = req.file ? `/uploads/finance/${req.file.filename}` : null;

    const result = await db.run(
      `INSERT INTO petty_cash_transactions 
       (ledger_id, transaction_date, petty_cash_slip_no, description, amount_deposited, 
        amount_withdrawn, balance, charged_to, received_by_type, received_by_staff_id, 
        received_by_name, approved_by_id, attachment_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, transaction_date, slipNo, description || 'Petty cash transaction', deposited, withdrawn, newBalance,
       charged_to || null, received_by_type || null, received_by_staff_id || null, received_by_name || null,
       req.user.id, attachmentPath]
    );

    await logAction(req.user.id, 'add_petty_cash_transaction', 'finance', result.lastID, { ledger_id: req.params.id }, req);

    // Calculate totals
    const allTransactions = await db.all(
      'SELECT amount_deposited, amount_withdrawn FROM petty_cash_transactions WHERE ledger_id = ?',
      [req.params.id]
    );
    const totalDeposited = allTransactions.reduce((sum, t) => sum + (parseFloat(t.amount_deposited) || 0), 0);
    const totalWithdrawn = allTransactions.reduce((sum, t) => sum + (parseFloat(t.amount_withdrawn) || 0), 0);
    const closingBalance = ledger.starting_balance + totalDeposited - totalWithdrawn;

    // Emit real-time event
    if (global.io) {
      global.io.emit('petty_cash_transaction_added', {
        id: result.lastID,
        ledger_id: req.params.id,
        transaction_date,
        amount_deposited: deposited,
        amount_withdrawn: withdrawn,
        balance: newBalance,
        total_deposited: totalDeposited,
        total_withdrawn: totalWithdrawn,
        closing_balance: closingBalance
      });
    }

    res.status(201).json({
      message: 'Transaction added successfully',
      transaction: { 
        id: result.lastID, 
        balance: newBalance, 
        slip_no: slipNo,
        total_deposited: totalDeposited,
        total_withdrawn: totalWithdrawn,
        closing_balance: closingBalance
      }
    });
  } catch (error) {
    console.error('Add transaction error:', error);
    res.status(500).json({ error: 'Failed to add transaction: ' + error.message });
  }
});

// Update petty cash transaction
router.put('/petty-cash/transactions/:id', authenticateToken, [
  body('transaction_date').optional().isISO8601(),
  body('amount_deposited').optional().isFloat({ min: 0 }),
  body('amount_withdrawn').optional().isFloat({ min: 0 }),
  body('description').optional().trim(),
  body('charged_to').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!(await canManagePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const transaction = await db.get('SELECT * FROM petty_cash_transactions WHERE id = ?', [req.params.id]);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updates = req.body;
    const updateFields = [];
    const params = [];

    if (updates.transaction_date) {
      updateFields.push('transaction_date = ?');
      params.push(updates.transaction_date);
    }
    if (updates.amount_deposited !== undefined) {
      updateFields.push('amount_deposited = ?');
      params.push(parseFloat(updates.amount_deposited) || 0);
    }
    if (updates.amount_withdrawn !== undefined) {
      updateFields.push('amount_withdrawn = ?');
      params.push(parseFloat(updates.amount_withdrawn) || 0);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.charged_to !== undefined) {
      updateFields.push('charged_to = ?');
      params.push(updates.charged_to);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);
        await db.run(
      `UPDATE petty_cash_transactions 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
      params
    );

    // Recalculate balances
    const ledger = await db.get('SELECT * FROM petty_cash_ledgers WHERE id = ?', [transaction.ledger_id]);
    const allTransactions = await db.all(
      'SELECT * FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date, id',
      [transaction.ledger_id]
    );

    let runningBalance = ledger.starting_balance;
    for (const t of allTransactions) {
      runningBalance = runningBalance + (parseFloat(t.amount_deposited) || 0) - (parseFloat(t.amount_withdrawn) || 0);
      await db.run('UPDATE petty_cash_transactions SET balance = ? WHERE id = ?', [runningBalance, t.id]);
    }

    await logAction(req.user.id, 'update_petty_cash_transaction', 'finance', req.params.id, updates, req);

    // Emit real-time event
    if (global.io) {
      global.io.emit('petty_cash_transaction_updated', {
        id: req.params.id,
        ledger_id: transaction.ledger_id,
        ...updates
      });
    }

    res.json({ message: 'Transaction updated successfully' });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ error: 'Failed to update transaction: ' + error.message });
  }
});

// Delete petty cash transaction (Assistant Finance Officer and Finance Department Head only)
router.delete('/petty-cash/transactions/:id', authenticateToken, async (req, res) => {
  try {
    if (!(await canDeletePettyCash(req.user))) {
      return res.status(403).json({ error: 'Access denied. Only Assistant Finance Officer and Finance Department Head can delete transactions.' });
    }

    const transaction = await db.get('SELECT * FROM petty_cash_transactions WHERE id = ?', [req.params.id]);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    await db.run('DELETE FROM petty_cash_transactions WHERE id = ?', [req.params.id]);

    // Recalculate balances
    const ledger = await db.get('SELECT * FROM petty_cash_ledgers WHERE id = ?', [transaction.ledger_id]);
    if (!ledger) {
      return res.status(404).json({ error: 'Ledger not found for this transaction' });
    }

    const allTransactions = await db.all(
      'SELECT * FROM petty_cash_transactions WHERE ledger_id = ? ORDER BY transaction_date, id',
      [transaction.ledger_id]
    );

    // If no transactions remain, reset starting balance to 0
    if (allTransactions.length === 0) {
      await db.run('UPDATE petty_cash_ledgers SET starting_balance = 0 WHERE id = ?', [transaction.ledger_id]);
      console.log(`[PettyCash] Reset starting balance to 0 for ledger ${transaction.ledger_id} after deleting all transactions`);
    } else {
      // Recalculate balances for remaining transactions
      let runningBalance = ledger.starting_balance || 0;
      for (const t of allTransactions) {
        runningBalance = runningBalance + (parseFloat(t.amount_deposited) || 0) - (parseFloat(t.amount_withdrawn) || 0);
        await db.run('UPDATE petty_cash_transactions SET balance = ? WHERE id = ?', [runningBalance, t.id]);
      }
    }

    await logAction(req.user.id, 'delete_petty_cash_transaction', 'finance', req.params.id, {}, req);

    // Emit real-time event
    if (global.io) {
      global.io.emit('petty_cash_transaction_deleted', {
        id: req.params.id,
        ledger_id: transaction.ledger_id,
        deleted_by: req.user.id
      });
    }

    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ error: 'Failed to delete transaction: ' + error.message });
  }
});

// ==========================================
// ASSET REGISTRY ROUTES
// ==========================================

// Get staff + department heads for asset responsible person selection
router.get('/assets/staff', authenticateToken, async (req, res) => {
  try {
    if (!(await isFinanceStaff(req.user)) && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied. Only Finance staff and Admin can view staff list.' });
    }

    const staff = await db.all(
      `SELECT s.id, s.staff_id, s.department, s.position, u.name, u.email, 'Staff' as role_type
       FROM staff s
       JOIN users u ON s.user_id = u.id
       WHERE u.is_active = 1`
    );

    const deptHeads = await db.all(
      `SELECT d.manager_id as id, 'DEPT-' || d.manager_id as staff_id, d.name as department,
              d.name as position, u.name, u.email, 'DepartmentHead' as role_type
       FROM departments d
       JOIN users u ON d.manager_id = u.id
       WHERE u.is_active = 1
       GROUP BY d.manager_id, d.name, u.name, u.email`
    );

    const combined = [...staff, ...deptHeads].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );

    res.json({ staff: combined });
  } catch (error) {
    console.error('Get asset staff list error:', error);
    res.status(500).json({ error: 'Failed to fetch staff list: ' + error.message });
  }
});

// Get all assets
router.get('/assets', authenticateToken, async (req, res) => {
  try {
    const { category, department, location, search } = req.query;
    let query = `
      SELECT a.*,
             resp.name as responsible_person_name, resp_staff.staff_id as responsible_person_staff_id,
             creator.name as added_by_name,
             reviewer.name as reviewed_by_name,
             approver.name as approved_by_name
      FROM assets a
      LEFT JOIN staff resp_staff ON a.responsible_person_id = resp_staff.id
      LEFT JOIN users resp ON resp_staff.user_id = resp.id
      LEFT JOIN users creator ON a.added_by = creator.id
      LEFT JOIN users reviewer ON a.reviewed_by_id = reviewer.id
      LEFT JOIN users approver ON a.approved_by_id = approver.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      query += ' AND a.asset_category = ?';
      params.push(category);
    }
    if (department) {
      query += ' AND a.department = ?';
      params.push(department);
    }
    if (location) {
      query += ' AND a.location = ?';
      params.push(location);
    }
    if (search) {
      query += ' AND (a.asset_description LIKE ? OR a.asset_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY a.date_acquired DESC, a.id DESC';

    const assets = await db.all(query, params);

    // Calculate current book value for each asset (as of today)
    const today = new Date();
    for (const asset of assets) {
      const acquiredDate = new Date(asset.date_acquired);
      const yearsSinceAcquired = (today - acquiredDate) / (1000 * 60 * 60 * 24 * 365);
      
      if (yearsSinceAcquired > 0 && asset.depreciation_expense_per_annum) {
        const accumulatedDep = Math.min(
          yearsSinceAcquired * asset.depreciation_expense_per_annum,
          asset.purchase_price_usd
        );
        asset.accumulated_depreciation = accumulatedDep;
        asset.current_book_value = asset.purchase_price_usd - accumulatedDep;
      } else {
        asset.accumulated_depreciation = 0;
        asset.current_book_value = asset.purchase_price_usd;
      }
    }

    res.json({ assets });
  } catch (error) {
    console.error('Get assets error:', error);
    res.status(500).json({ error: 'Failed to fetch assets: ' + error.message });
  }
});

// Get single asset
router.get('/assets/:id', authenticateToken, async (req, res) => {
  try {
    const asset = await db.get(
      `SELECT a.*,
              resp.name as responsible_person_name,
              creator.name as added_by_name
       FROM assets a
       LEFT JOIN staff resp_staff ON a.responsible_person_id = resp_staff.id
       LEFT JOIN users resp ON resp_staff.user_id = resp.id
       LEFT JOIN users creator ON a.added_by = creator.id
       WHERE a.id = ?`,
      [req.params.id]
    );

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Get depreciation history
    const depreciations = await db.all(
      'SELECT * FROM asset_depreciations WHERE asset_id = ? ORDER BY depreciation_year',
      [req.params.id]
    );

    asset.depreciations = depreciations;

    // Calculate current book value
    const today = new Date();
    const acquiredDate = new Date(asset.date_acquired);
    const yearsSinceAcquired = (today - acquiredDate) / (1000 * 60 * 60 * 24 * 365);
    if (yearsSinceAcquired > 0 && asset.depreciation_expense_per_annum) {
      const accumulatedDep = Math.min(
        yearsSinceAcquired * asset.depreciation_expense_per_annum,
        asset.purchase_price_usd
      );
      asset.accumulated_depreciation = accumulatedDep;
      asset.current_book_value = asset.purchase_price_usd - accumulatedDep;
    } else {
      asset.accumulated_depreciation = 0;
      asset.current_book_value = asset.purchase_price_usd;
    }

    res.json({ asset });
  } catch (error) {
    console.error('Get asset error:', error);
    res.status(500).json({ error: 'Failed to fetch asset' });
  }
});

// Create asset
router.post('/assets', authenticateToken, upload.single('attachment'), [
  body('asset_description').trim().notEmpty().withMessage('Asset description is required'),
  body('asset_category').trim().notEmpty().withMessage('Asset category is required'),
  body('department').trim().notEmpty().withMessage('Department is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('date_acquired').isISO8601().withMessage('Valid date acquired required'),
  body('purchase_price_usd').isFloat({ min: 0 }).withMessage('Purchase price must be >= 0'),
  body('responsible_person_id').isInt().withMessage('Responsible person is required'),
  body('expected_useful_life_years').isInt({ min: 1, max: 100 }).withMessage('Useful life must be 1-100 years')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!(await isFinanceStaff(req.user)) && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Finance staff can create assets' });
    }

    const {
      asset_description, asset_category, department, location, date_acquired,
      supplier, purchase_price_usd, purchase_price_lrd, asset_condition,
      serial_number, warranty_expiry_date, expected_useful_life_years,
      responsible_person_id, remarks
    } = req.body;

    // Generate asset ID
    const assetId = generateAssetId(asset_category);

    // Check if asset ID already exists (very unlikely but check anyway)
    let finalAssetId = assetId;
    let counter = 1;
    while (await db.get('SELECT id FROM assets WHERE asset_id = ?', [finalAssetId])) {
      finalAssetId = `${assetId.slice(0, -2)}${String(counter).padStart(2, '0')}`;
      counter++;
    }

    // Calculate depreciation
    const depreciationRate = parseFloat(req.body.depreciation_rate_annual || 0.05); // Default 5%
    const depreciationExpensePerAnnum = parseFloat(purchase_price_usd) * depreciationRate;
    const depreciationPerMonth = depreciationExpensePerAnnum / 12;

    const attachmentPath = req.file ? `/uploads/finance/${req.file.filename}` : null;

    // No approval flow - set status directly to 'Approved'
    let initialStatus = 'Approved';
    let deptHeadStatus = null;
    
    if (await isAssistantFinanceOfficer(req.user)) {
      initialStatus = 'Approved'; // No approval needed
      deptHeadStatus = null;
    }

    const result = await db.run(
      `INSERT INTO assets 
       (asset_id, asset_description, asset_category, department, location, date_acquired,
        supplier, purchase_price_usd, purchase_price_lrd, asset_condition, serial_number,
        warranty_expiry_date, expected_useful_life_years, depreciation_rate_annual,
        depreciation_expense_per_annum, depreciation_per_month, responsible_person_id,
        remarks, attachment_path, added_by, approval_status, dept_head_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [finalAssetId, asset_description, asset_category, department, location, date_acquired,
       supplier || null, parseFloat(purchase_price_usd), purchase_price_lrd ? parseFloat(purchase_price_lrd) : null,
       asset_condition || 'Good', serial_number || null, warranty_expiry_date || null,
       parseInt(expected_useful_life_years), depreciationRate, depreciationExpensePerAnnum,
       depreciationPerMonth, parseInt(responsible_person_id), remarks || null,
       attachmentPath, req.user.id, initialStatus, deptHeadStatus]
    );

    await logAction(req.user.id, 'create_asset', 'finance', result.lastID, { asset_id: finalAssetId }, req);

    res.status(201).json({
      message: 'Asset created successfully',
      asset: { id: result.lastID, asset_id: finalAssetId }
    });
  } catch (error) {
    console.error('Create asset error:', error);
    res.status(500).json({ error: 'Failed to create asset: ' + error.message });
  }
});

// Update asset
router.put('/assets/:id', authenticateToken, upload.single('attachment'), async (req, res) => {
  try {
    if (!(await canManageAssets(req.user))) {
      return res.status(403).json({ error: 'Only Finance staff and Admin can update assets' });
    }

    const asset = await db.get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const updates = req.body || {};
    const fields = [];
    const params = [];

    const setField = (field, value) => {
      fields.push(`${field} = ?`);
      params.push(value);
    };

    if (updates.asset_description !== undefined) setField('asset_description', updates.asset_description);
    if (updates.asset_category !== undefined) setField('asset_category', updates.asset_category);
    if (updates.department !== undefined) setField('department', updates.department);
    if (updates.location !== undefined) setField('location', updates.location);
    if (updates.date_acquired !== undefined) setField('date_acquired', updates.date_acquired);
    if (updates.supplier !== undefined) setField('supplier', updates.supplier || null);
    if (updates.purchase_price_usd !== undefined) setField('purchase_price_usd', parseFloat(updates.purchase_price_usd));
    if (updates.purchase_price_lrd !== undefined) {
      setField('purchase_price_lrd', updates.purchase_price_lrd === '' ? null : parseFloat(updates.purchase_price_lrd));
    }
    if (updates.asset_condition !== undefined) setField('asset_condition', updates.asset_condition || 'Good');
    if (updates.serial_number !== undefined) setField('serial_number', updates.serial_number || null);
    if (updates.warranty_expiry_date !== undefined) setField('warranty_expiry_date', updates.warranty_expiry_date || null);
    if (updates.expected_useful_life_years !== undefined) {
      setField('expected_useful_life_years', parseInt(updates.expected_useful_life_years));
    }
    if (updates.depreciation_rate_annual !== undefined) {
      setField('depreciation_rate_annual', parseFloat(updates.depreciation_rate_annual));
    }
    if (updates.responsible_person_id !== undefined) {
      setField('responsible_person_id', parseInt(updates.responsible_person_id));
    }
    if (updates.remarks !== undefined) setField('remarks', updates.remarks || null);

    if (req.file) {
      const attachmentPath = `/uploads/finance/${req.file.filename}`;
      setField('attachment_path', attachmentPath);
    }

    const purchasePriceUsd = updates.purchase_price_usd !== undefined
      ? parseFloat(updates.purchase_price_usd)
      : parseFloat(asset.purchase_price_usd || 0);
    const depreciationRate = updates.depreciation_rate_annual !== undefined
      ? parseFloat(updates.depreciation_rate_annual)
      : parseFloat(asset.depreciation_rate_annual || 0.05);

    const shouldRecalcDep = updates.purchase_price_usd !== undefined || updates.depreciation_rate_annual !== undefined;
    if (shouldRecalcDep) {
      const depreciationExpensePerAnnum = purchasePriceUsd * depreciationRate;
      const depreciationPerMonth = depreciationExpensePerAnnum / 12;
      setField('depreciation_expense_per_annum', depreciationExpensePerAnnum);
      setField('depreciation_per_month', depreciationPerMonth);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    await db.run(
      `UPDATE assets SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    await logAction(req.user.id, 'update_asset', 'finance', req.params.id, {}, req);

    res.json({ message: 'Asset updated successfully' });
  } catch (error) {
    console.error('Update asset error:', error);
    res.status(500).json({ error: 'Failed to update asset: ' + error.message });
  }
});

// Delete asset
router.delete('/assets/:id', authenticateToken, async (req, res) => {
  try {
    if (!(await canManageAssets(req.user))) {
      return res.status(403).json({ error: 'Only Finance staff and Admin can delete assets' });
    }

    const asset = await db.get('SELECT id, attachment_path FROM assets WHERE id = ?', [req.params.id]);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    await db.run('DELETE FROM assets WHERE id = ?', [req.params.id]);

    if (asset.attachment_path) {
      try {
        const fullPath = path.join(__dirname, '../..', asset.attachment_path);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (cleanupError) {
        console.warn('Asset attachment cleanup warning:', cleanupError.message);
      }
    }

    await logAction(req.user.id, 'delete_asset', 'finance', req.params.id, {}, req);

    res.json({ message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('Delete asset error:', error);
    res.status(500).json({ error: 'Failed to delete asset: ' + error.message });
  }
});

// Approve asset (Legacy - kept but not used since no approval flow)
router.put('/assets/:id/approve', authenticateToken, [
  body('approved').isBoolean().withMessage('Approval status required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const asset = await db.get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // No approval flow - just return success
    res.json({ message: 'Asset approval not required' });
  } catch (error) {
    console.error('Approve asset error:', error);
    res.status(500).json({ error: 'Failed to approve asset: ' + error.message });
  }
});

// Get monthly acquisition sheet
router.get('/assets/monthly/:year/:month', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.params;
    const assets = await db.all(
      `SELECT * FROM assets 
       WHERE strftime('%Y', date_acquired) = ? AND strftime('%m', date_acquired) = ?
       ORDER BY date_acquired, id`,
      [year, String(month).padStart(2, '0')]
    );

    const total = assets.reduce((sum, a) => sum + parseFloat(a.purchase_price_usd || 0), 0);

    res.json({
      year: parseInt(year),
      month: parseInt(month),
      assets,
      total_acquisition_amount: total
    });
  } catch (error) {
    console.error('Get monthly acquisitions error:', error);
    res.status(500).json({ error: 'Failed to fetch monthly acquisitions' });
  }
});

module.exports = router;
