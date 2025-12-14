const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// Config loading logic (same as contractor.js)
let config;
try {
    if (process.env.DB_HOST && fs.existsSync(path.join(__dirname, '../config.docker.js'))) {
        config = require('../config.docker');
    } else {
        config = require('../config');
    }
} catch (err) {
    try {
        config = require('../config.docker');
    } catch (e) {
        console.error('Critical: No configuration file found in supplier.js');
    }
}

const pool = mysql.createPool(config.db);

// ====================================================
// Helper: Render with Layout for Supplier
// ====================================================
const renderWithLayout = async (req, res, viewName, data) => {
    try {
        const supplierId = req.signedCookies.userId;
        let currentSupplier = { SupplierName: 'Supplier', Email: '', Address: '', PhoneNumber: '' };
        let unreadMessageCount = 0;

        if (supplierId) {
            const [suppliers] = await pool.execute('SELECT * FROM Suppliers WHERE SupplierID = ?', [supplierId]);
            if (suppliers.length > 0) currentSupplier = suppliers[0];

            // Count unread conversations (messages from contractors)
            try {
                const [msgResult] = await pool.execute(
                    `SELECT COUNT(DISTINCT ContractorID) as count
                     FROM ContractorSupplierMessages
                     WHERE SupplierID = ? AND SenderType = 'Contractor'`,
                    [supplierId]
                );
                unreadMessageCount = msgResult[0].count;
            } catch (e) { }
        }

        let viewPath = viewName;
        if (!viewName.includes('/')) viewPath = `supplier/${viewName}`;
        if (!viewPath.endsWith('.hjs')) viewPath += '.hjs';

        res.render(viewPath, data, (err, html) => {
            if (err) {
                console.error(`Error rendering view ${viewPath}:`, err);
                return res.status(500).send(`Template Error: ${err.message}`);
            }

            res.render('supplier_layout.hjs', {
                ...data,
                content: html,
                supplierName: currentSupplier.SupplierName,
                supplierEmail: currentSupplier.Email,
                supplierPhone: currentSupplier.PhoneNumber,
                supplierAddress: currentSupplier.Address,
                messageCount: unreadMessageCount,
                [`is${viewName.replace('supplier/', '').charAt(0).toUpperCase() + viewName.replace('supplier/', '').slice(1)}`]: true
            });
        });
    } catch (err) {
        console.error("Render Helper Error:", err);
        res.status(500).send("Internal Server Error");
    }
};

// Helper: Status color mapping
const getStatusColor = (status) => {
    const colors = {
        'Pending': 'bg-yellow-100 text-yellow-800 border-yellow-200',
        'Processing': 'bg-blue-100 text-blue-800 border-blue-200',
        'Shipped': 'bg-purple-100 text-purple-800 border-purple-200',
        'Delivered': 'bg-green-100 text-green-800 border-green-200',
        'Cancelled': 'bg-red-100 text-red-800 border-red-200'
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-200';
};

// ==========================================
// 1. Dashboard
// ==========================================
router.get('/dashboard', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;

        // Get total orders count
        const [ordersResult] = await pool.execute(
            'SELECT COUNT(*) as totalOrders FROM PurchaseOrder WHERE SupplierID = ?',
            [supplierId]
        );

        // Get pending orders count
        const [pendingResult] = await pool.execute(
            'SELECT COUNT(*) as pendingOrders FROM PurchaseOrder WHERE SupplierID = ? AND Status IN ("Pending", "Processing")',
            [supplierId]
        );

        // Get total revenue
        const [revenueResult] = await pool.execute(
            'SELECT COALESCE(SUM(TotalAmount), 0) as totalRevenue FROM PurchaseOrder WHERE SupplierID = ? AND Status != "Cancelled"',
            [supplierId]
        );

        // Get active contractors (unique contractors who have ordered)
        const [contractorsResult] = await pool.execute(
            'SELECT COUNT(DISTINCT ContractorID) as activeContractors FROM PurchaseOrder WHERE SupplierID = ?',
            [supplierId]
        );

        // Get recent orders
        const [recentOrders] = await pool.execute(
            `SELECT PO.*, C.Name as ContractorName, P.ProjectName
             FROM PurchaseOrder PO
             JOIN Contractors C ON PO.ContractorID = C.ContractorID
             JOIN Projects P ON PO.ProjectID = P.ProjectID
             WHERE PO.SupplierID = ?
             ORDER BY PO.OrderDate DESC
             LIMIT 5`,
            [supplierId]
        );

        const formattedRecentOrders = recentOrders.map(order => ({
            ...order,
            TotalAmount: order.TotalAmount ? order.TotalAmount.toLocaleString() : '0',
            StatusColor: getStatusColor(order.Status)
        }));

        // Get chart data for revenue by month
        const [chartData] = await pool.execute(
            `SELECT DATE_FORMAT(OrderDate, '%Y-%m') as Month, SUM(TotalAmount) as Revenue
             FROM PurchaseOrder
             WHERE SupplierID = ? AND Status != 'Cancelled'
             GROUP BY DATE_FORMAT(OrderDate, '%Y-%m')
             ORDER BY Month DESC
             LIMIT 6`,
            [supplierId]
        );

        const hasChartData = chartData.length > 0;
        const chartLabels = JSON.stringify(chartData.map(d => d.Month).reverse());
        const chartValues = JSON.stringify(chartData.map(d => parseFloat(d.Revenue) || 0).reverse());

        await renderWithLayout(req, res, 'dashboard', {
            title: 'Supplier Dashboard',
            totalOrders: ordersResult[0].totalOrders,
            pendingOrders: pendingResult[0].pendingOrders,
            totalRevenue: parseFloat(revenueResult[0].totalRevenue).toLocaleString(),
            activeContractors: contractorsResult[0].activeContractors,
            recentOrders: formattedRecentOrders,
            hasChartData,
            chartLabels,
            chartData: chartValues
        });

    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Error loading dashboard');
    }
});

// ==========================================
// 2. Orders List
// ==========================================
router.get('/orders', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const filterStatus = req.query.status;

        let sql = `
            SELECT PO.*, C.Name as ContractorName, P.ProjectName
            FROM PurchaseOrder PO
            JOIN Contractors C ON PO.ContractorID = C.ContractorID
            JOIN Projects P ON PO.ProjectID = P.ProjectID
            WHERE PO.SupplierID = ?
        `;
        let params = [supplierId];

        if (filterStatus) {
            sql += ' AND PO.Status = ?';
            params.push(filterStatus);
        }

        sql += ' ORDER BY PO.OrderDate DESC';

        const [orders] = await pool.execute(sql, params);

        const formattedOrders = orders.map(order => {
            const orderDate = new Date(order.OrderDate);
            const estimatedArrival = new Date(orderDate);
            estimatedArrival.setDate(estimatedArrival.getDate() + 7);

            return {
                ...order,
                FormattedDate: orderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                FormattedTotal: order.TotalAmount ? order.TotalAmount.toLocaleString() : '0',
                FormattedArrival: estimatedArrival.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                StatusColor: getStatusColor(order.Status),
                IsPending: order.Status === 'Pending',
                IsProcessing: order.Status === 'Processing',
                IsShipped: order.Status === 'Shipped',
                IsDelivered: order.Status === 'Delivered',
                IsCancelled: order.Status === 'Cancelled',
                ProgressWidth: {
                    'Pending': '12%',
                    'Processing': '37%',
                    'Shipped': '62%',
                    'Delivered': '100%'
                }[order.Status] || '0%'
            };
        });

        // Count by status for filter tabs
        const [statusCounts] = await pool.execute(
            `SELECT Status, COUNT(*) as Count
             FROM PurchaseOrder
             WHERE SupplierID = ?
             GROUP BY Status`,
            [supplierId]
        );

        const statusMap = {};
        statusCounts.forEach(s => { statusMap[s.Status] = s.Count; });

        await renderWithLayout(req, res, 'orders', {
            title: 'Orders',
            orders: formattedOrders,
            filterStatus: filterStatus || '',
            pendingCount: statusMap['Pending'] || 0,
            processingCount: statusMap['Processing'] || 0,
            shippedCount: statusMap['Shipped'] || 0,
            deliveredCount: statusMap['Delivered'] || 0,
            allCount: orders.length
        });

    } catch (err) {
        console.error('Orders error:', err);
        res.status(500).send('Error loading orders');
    }
});

// ==========================================
// 3. Order Details
// ==========================================
router.get('/orders/:id', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const poId = req.params.id;

        // Get order details
        const [orders] = await pool.execute(
            `SELECT PO.*, C.Name as ContractorName, C.Email as ContractorEmail,
                    C.PhoneNumber as ContractorPhone, C.Address as ContractorAddress,
                    P.ProjectName, P.Location as ProjectLocation
             FROM PurchaseOrder PO
             JOIN Contractors C ON PO.ContractorID = C.ContractorID
             JOIN Projects P ON PO.ProjectID = P.ProjectID
             WHERE PO.POID = ? AND PO.SupplierID = ?`,
            [poId, supplierId]
        );

        if (orders.length === 0) {
            return res.redirect('/supplier/orders');
        }

        const order = orders[0];

        // Get order items
        const [items] = await pool.execute(
            `SELECT POI.*, M.MaterialName, U.UnitName
             FROM POItems POI
             JOIN Materials M ON POI.MaterialID = M.MaterialID
             LEFT JOIN Units U ON M.UnitID = U.UnitID
             WHERE POI.POID = ?`,
            [poId]
        );

        const formattedItems = items.map(item => ({
            ...item,
            Subtotal: (item.Quantity * item.UnitPrice).toLocaleString(),
            UnitPrice: item.UnitPrice.toLocaleString()
        }));

        const orderDate = new Date(order.OrderDate);
        const estimatedArrival = new Date(orderDate);
        estimatedArrival.setDate(estimatedArrival.getDate() + 7);

        await renderWithLayout(req, res, 'order_details', {
            title: `Order #PO-${poId}`,
            order: {
                ...order,
                FormattedDate: orderDate.toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                }),
                FormattedTotal: order.TotalAmount ? order.TotalAmount.toLocaleString() : '0',
                FormattedArrival: estimatedArrival.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                StatusColor: getStatusColor(order.Status),
                IsPending: order.Status === 'Pending',
                IsProcessing: order.Status === 'Processing',
                IsShipped: order.Status === 'Shipped',
                IsDelivered: order.Status === 'Delivered',
                ProgressWidth: {
                    'Pending': '12%',
                    'Processing': '37%',
                    'Shipped': '62%',
                    'Delivered': '100%'
                }[order.Status] || '0%'
            },
            items: formattedItems
        });

    } catch (err) {
        console.error('Order details error:', err);
        res.status(500).send('Error loading order details');
    }
});

// ==========================================
// 4. Update Order Status
// ==========================================
router.post('/orders/:id/update-status', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const poId = req.params.id;
        const { status } = req.body;

        const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
        const isValidStatus = validStatuses.includes(status);
        if (!isValidStatus) {
            return res.redirect(`/supplier/orders/${poId}`);
        }

        // Get current order to find contractor for notification
        const [orders] = await pool.execute(
            'SELECT ContractorID, Status FROM PurchaseOrder WHERE POID = ? AND SupplierID = ?',
            [poId, supplierId]
        );

        if (orders.length === 0) {
            return res.redirect('/supplier/orders');
        }

        const currentOrder = orders[0];

        let sql = 'UPDATE PurchaseOrder SET Status = ?';
        let params = [status];

        // Generate tracking number when shipping
        if (status === 'Shipped' && currentOrder.Status !== 'Shipped') {
            const trackingNum = 'TN-' + Math.floor(100000 + Math.random() * 900000);
            sql += ', TrackingNumber = ?';
            params.push(trackingNum);
        }

        sql += ' WHERE POID = ? AND SupplierID = ?';
        params.push(poId, supplierId);

        await pool.execute(sql, params);

        // Create notification for contractor
        try {
            await pool.execute(
                'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                [currentOrder.ContractorID, 'Order Status Update', `Order #PO-${poId} status updated to ${status}.`, `/contractor/orders#order-${poId}`]
            );
        } catch (e) { }

        res.redirect(`/supplier/orders/${poId}`);

    } catch (err) {
        console.error('Update status error:', err);
        res.redirect('/supplier/orders');
    }
});

// ==========================================
// 5. Messages List (Conversations)
// ==========================================
router.get('/messages', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;

        // Get all contractors who have messaged this supplier
        const [conversations] = await pool.execute(
            `SELECT DISTINCT C.ContractorID, C.Name, C.Email,
                    (SELECT MessageText FROM ContractorSupplierMessages
                     WHERE ContractorID = C.ContractorID AND SupplierID = ?
                     ORDER BY CreatedAt DESC LIMIT 1) as LastMessage,
                    (SELECT CreatedAt FROM ContractorSupplierMessages
                     WHERE ContractorID = C.ContractorID AND SupplierID = ?
                     ORDER BY CreatedAt DESC LIMIT 1) as LastMessageTime
             FROM ContractorSupplierMessages CSM
             JOIN Contractors C ON CSM.ContractorID = C.ContractorID
             WHERE CSM.SupplierID = ?
             GROUP BY C.ContractorID
             ORDER BY LastMessageTime DESC`,
            [supplierId, supplierId, supplierId]
        );

        const formattedConversations = conversations.map(conv => ({
            ...conv,
            LastMessageTime: conv.LastMessageTime ?
                new Date(conv.LastMessageTime).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : '',
            LastMessagePreview: conv.LastMessage ?
                (conv.LastMessage.length > 50 ? conv.LastMessage.substring(0, 50) + '...' : conv.LastMessage) : ''
        }));

        await renderWithLayout(req, res, 'messages', {
            title: 'Messages',
            conversations: formattedConversations,
            hasConversations: conversations.length > 0
        });

    } catch (err) {
        console.error('Messages error:', err);
        res.status(500).send('Error loading messages');
    }
});

// ==========================================
// 6. Message Conversation with Contractor
// ==========================================
router.get('/messages/:contractorId', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const contractorId = req.params.contractorId;

        // Get contractor info
        const [contractors] = await pool.execute(
            'SELECT * FROM Contractors WHERE ContractorID = ?',
            [contractorId]
        );

        if (contractors.length === 0) {
            return res.redirect('/supplier/messages');
        }

        const contractor = contractors[0];

        // Get messages
        const [messages] = await pool.execute(
            `SELECT MessageID, SenderType, MessageText, CreatedAt
             FROM ContractorSupplierMessages
             WHERE ContractorID = ? AND SupplierID = ?
             ORDER BY CreatedAt ASC
             LIMIT 200`,
            [contractorId, supplierId]
        );

        const formattedMessages = messages.map(m => ({
            id: m.MessageID,
            sender: m.SenderType,
            text: m.MessageText,
            createdAt: (m.CreatedAt instanceof Date ? m.CreatedAt : new Date(m.CreatedAt)).toISOString()
        }));

        await renderWithLayout(req, res, 'message_detail', {
            title: `Chat with ${contractor.Name}`,
            contractor,
            messages: formattedMessages,
            messagesJson: JSON.stringify(formattedMessages)
        });

    } catch (err) {
        console.error('Message detail error:', err);
        res.redirect('/supplier/messages');
    }
});

// ==========================================
// 7. Send Message to Contractor
// ==========================================
router.post('/messages/:contractorId', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const contractorId = req.params.contractorId;
        const raw = (req.body.message || '').trim();

        if (!raw) {
            return res.redirect(`/supplier/messages/${contractorId}?error=empty`);
        }

        const message = raw.slice(0, 2000);

        await pool.execute(
            `INSERT INTO ContractorSupplierMessages (ContractorID, SupplierID, SenderType, MessageText)
             VALUES (?, ?, 'Supplier', ?)`,
            [contractorId, supplierId, message]
        );

        res.redirect(`/supplier/messages/${contractorId}`);
    } catch (err) {
        console.error('Send message error:', err);
        res.redirect(`/supplier/messages/${req.params.contractorId}?error=failed`);
    }
});

// ==========================================
// 8. Messages JSON Feed (for polling)
// ==========================================
router.get('/messages/:contractorId/feed', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const contractorId = req.params.contractorId;
        const since = req.query.since ? new Date(req.query.since) : null;

        let sql = `
            SELECT MessageID, SenderType, MessageText, CreatedAt
            FROM ContractorSupplierMessages
            WHERE ContractorID = ? AND SupplierID = ?
        `;
        const params = [contractorId, supplierId];

        if (since && !isNaN(since.getTime())) {
            sql += ' AND CreatedAt > ?';
            params.push(since);
        }

        sql += ' ORDER BY CreatedAt ASC LIMIT 200';

        const [rows] = await pool.execute(sql, params);
        res.json({
            messages: rows.map(m => ({
                id: m.MessageID,
                sender: m.SenderType,
                text: m.MessageText,
                createdAt: (m.CreatedAt instanceof Date ? m.CreatedAt : new Date(m.CreatedAt)).toISOString()
            }))
        });
    } catch (err) {
        console.error('Messages feed error:', err);
        res.json({ messages: [] });
    }
});

// ==========================================
// 9. Profile
// ==========================================
router.get('/profile', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;

        const [suppliers] = await pool.execute(
            'SELECT * FROM Suppliers WHERE SupplierID = ?',
            [supplierId]
        );

        if (suppliers.length === 0) {
            return res.redirect('/supplier/dashboard');
        }

        await renderWithLayout(req, res, 'profile', {
            title: 'Profile',
            supplier: suppliers[0]
        });

    } catch (err) {
        console.error('Profile error:', err);
        res.redirect('/supplier/dashboard');
    }
});

router.post('/profile/update', async (req, res) => {
    try {
        const supplierId = req.signedCookies.userId;
        const { name, email, phone, address, description } = req.body;

        await pool.execute(
            'UPDATE Suppliers SET SupplierName = ?, Email = ?, PhoneNumber = ?, Address = ?, Description = ? WHERE SupplierID = ?',
            [name, email, phone, address, description, supplierId]
        );

        res.cookie('username', name, { signed: true });
        res.redirect('/supplier/profile?success=updated');

    } catch (err) {
        console.error('Profile update error:', err);
        res.redirect('/supplier/profile?error=failed');
    }
});

module.exports = router;
