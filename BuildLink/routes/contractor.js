const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise'); 
const config = require('../config');
const pool = mysql.createPool(config.db);

// ====================================================
// Helper: 兩階段渲染 (包含抓取承包商資料 & 未讀通知數)
// ====================================================
const renderWithLayout = async (req, res, viewName, data) => {
    try {
        const contractorId = req.signedCookies.userId;
        let currentUser = { Name: 'Contractor', Email: '', Address: '', PhoneNumber: '' };
        let unreadCount = 0;

        if (contractorId) {
            // 1. 抓取當前使用者資料
            const [users] = await pool.execute('SELECT * FROM Contractors WHERE ContractorID = ?', [contractorId]);
            if (users.length > 0) {
                currentUser = users[0];
            }

            // 2. ★★★ 抓取未讀通知數量 (給 Navbar 紅點用) ★★★
            try {
                const [notifResult] = await pool.execute(
                    'SELECT COUNT(*) as count FROM Notifications WHERE ContractorID = ? AND IsRead = 0', 
                    [contractorId]
                );
                unreadCount = notifResult[0].count;
            } catch (e) {
                console.warn("Notifications table query failed (Table might not exist yet).");
            }
        }

        // 3. 處理 View 路徑
        let viewPath = viewName;
        if (!viewName.includes('/')) {
            viewPath = `contractor/${viewName}`;
        }
        if (!viewPath.endsWith('.hjs')) {
            viewPath += '.hjs';
        }

        // 4. 渲染內容
        res.render(viewPath, data, (err, html) => {
            if (err) {
                console.error(`Error rendering view ${viewPath}:`, err);
                return res.status(500).send(`Template Error: ${err.message}`);
            }
            
            // 5. 渲染 Layout，並傳入 Contractor 的資料與通知數量
            res.render('layout.hjs', { 
                ...data,
                content: html,
                contractorName: currentUser.Name,
                contractorEmail: currentUser.Email, 
                contractorPhone: currentUser.PhoneNumber, 
                contractorAddress: currentUser.Address,
                notificationCount: unreadCount, // ★★★ 傳入未讀數量給 Layout
                [`is${viewName.replace('contractor/', '').charAt(0).toUpperCase() + viewName.replace('contractor/', '').slice(1)}`]: true 
            });
        });
    } catch (err) {
        console.error("Render Helper Error:", err);
        res.status(500).send("Internal Server Error");
    }
};

// ==========================================
// 1. Dashboard
// ==========================================
router.get('/dashboard', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;

        // 1. Total Spend
        const [spendResult] = await pool.execute(
            'SELECT SUM(TotalAmount) as total FROM PurchaseOrder WHERE ContractorID = ?', 
            [contractorId]
        );
        const totalSpent = (spendResult[0].total || 0).toLocaleString();

        // 2. Active Orders
        const [activeOrderResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM PurchaseOrder WHERE ContractorID = ? AND Status != "Completed" AND Status != "Delivered"', 
            [contractorId]
        );
        const activeOrdersCount = activeOrderResult[0].count;

        // 3. Active Projects
        const [activeProjectResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM Projects WHERE ContractorID = ? AND Status != "Completed"', 
            [contractorId]
        );
        const activeProjectsCount = activeProjectResult[0].count;

        // 4. Recent Orders
        const [recentOrders] = await pool.execute(`
            SELECT PO.TotalAmount, PO.Status, P.ProjectName, S.SupplierName as SupplierName
            FROM PurchaseOrder PO
            JOIN Projects P ON PO.ProjectID = P.ProjectID
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            WHERE PO.ContractorID = ?
            ORDER BY PO.OrderDate DESC LIMIT 5
        `, [contractorId]);

        // 5. Top Suppliers
        const [topSuppliers] = await pool.execute(`
            SELECT * FROM Suppliers LIMIT 3
        `);

        await renderWithLayout(req, res, 'dashboard', {
            title: 'Dashboard',
            totalSpent,
            activeOrdersCount,
            activeProjectsCount,
            recentOrders,
            topSuppliers
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error: ' + err.message);
    }
});

// ==========================================
// 2. Suppliers List (支援搜尋功能)
// ==========================================
router.get('/suppliers', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        const searchType = req.query.type || 'supplier'; // 'supplier' or 'material'
        
        let sql = 'SELECT * FROM Suppliers';
        let params = [];

        if (searchQuery) {
            if (searchType === 'material') {
                sql = `
                    SELECT DISTINCT S.*, M.MaterialName as MatchedMaterial
                    FROM Suppliers S
                    JOIN SupplierMaterial SM ON S.SupplierID = SM.SupplierID
                    JOIN Materials M ON SM.MaterialID = M.MaterialID
                    WHERE M.MaterialName LIKE ?
                `;
                params = [`%${searchQuery}%`];
            } else {
                sql = 'SELECT * FROM Suppliers WHERE SupplierName LIKE ?';
                params = [`%${searchQuery}%`];
            }
        }

        const [rows] = await pool.execute(sql, params);
        
        const suppliers = rows.map(s => ({
            ...s,
            CompanyName: s.SupplierName || s.Name || s.CompanyName,
            CompanyID: s.SupplierID,
            isSupplier: true,
            MatchedMaterial: s.MatchedMaterial || null 
        }));

        await renderWithLayout(req, res, 'suppliers', {
            title: 'Suppliers',
            suppliers,
            searchQuery,
            searchType: searchType === 'material' ? 'Material' : 'Supplier Name',
            isTypeSupplier: searchType === 'supplier',
            isTypeMaterial: searchType === 'material'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ==========================================
// 3. Projects List
// ==========================================
router.get('/projects', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const [projects] = await pool.execute(
            'SELECT * FROM Projects WHERE ContractorID = ? ORDER BY StartDate DESC', 
            [contractorId]
        );
        
        await renderWithLayout(req, res, 'projects', {
            title: 'Projects',
            projects
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Add Project (POST)
router.post('/projects/add', async (req, res) => {
    try {
        const { projectName, location, startDate } = req.body;
        const contractorId = req.signedCookies.userId;

        await pool.execute(
            'INSERT INTO Projects (ContractorID, ProjectName, Location, StartDate, Status) VALUES (?, ?, ?, ?, ?)',
            [contractorId, projectName, location, startDate, 'Planning']
        );
        res.redirect('/contractor/projects');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating project');
    }
});

// ==========================================
// 4. Project Details
// ==========================================
router.get('/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        
        const [projectRows] = await pool.execute('SELECT * FROM Projects WHERE ProjectID = ?', [projectId]);
        const project = projectRows[0];

        const [orders] = await pool.execute(`
            SELECT PO.POID, PO.Status, PO.OrderDate, S.SupplierName as SupplierName
            FROM PurchaseOrder PO
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            WHERE PO.ProjectID = ?
        `, [projectId]);

        const ordersWithItems = orders.map(o => ({
            ...o,
            DeliveryDate: '2024-12-01', 
            Items: [
                { Material: 'Steel Beams', Quantity: 50, Price: 5000 },
                { Material: 'Cement Bags', Quantity: 200, Price: 1500 }
            ],
            DeliveryStatus: 'On The Way'
        }));

        await renderWithLayout(req, res, 'project_details', {
            title: project.ProjectName,
            project,
            orders: ordersWithItems
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/projects');
    }
});

// ==========================================
// 5. Create PO (選擇供應商，支援搜尋)
// ==========================================
router.get('/projects/:id/create-po', async (req, res) => {
    try {
        const projectId = req.params.id;
        const searchQuery = req.query.q || '';
        const searchType = req.query.type || 'supplier';
        
        // 1. 獲取專案資訊
        const [projectRows] = await pool.execute('SELECT * FROM Projects WHERE ProjectID = ?', [projectId]);

        let sql = 'SELECT * FROM Suppliers';
        let params = [];

        if (searchQuery) {
            if (searchType === 'material') {
                sql = `
                    SELECT DISTINCT S.*, M.MaterialName as MatchedMaterial
                    FROM Suppliers S
                    JOIN SupplierMaterial SM ON S.SupplierID = SM.SupplierID
                    JOIN Materials M ON SM.MaterialID = M.MaterialID
                    WHERE M.MaterialName LIKE ?
                `;
                params = [`%${searchQuery}%`];
            } else {
                sql = 'SELECT * FROM Suppliers WHERE SupplierName LIKE ?';
                params = [`%${searchQuery}%`];
            }
        }

        const [suppliers] = await pool.execute(sql, params);
        
        const suppliersFixed = suppliers.map(s => ({
            ...s,
            CompanyName: s.SupplierName || s.Name || s.CompanyName,
            CompanyID: s.SupplierID,
            MatchedMaterial: s.MatchedMaterial || null 
        }));
        
        await renderWithLayout(req, res, 'create_po', {
            title: 'Select Supplier',
            project: projectRows[0],
            suppliers: suppliersFixed,
            searchQuery,
            searchType: searchType === 'material' ? 'Material' : 'Supplier Name',
            isTypeSupplier: searchType === 'supplier',
            isTypeMaterial: searchType === 'material'
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/projects');
    }
});

// ==========================================
// 6. Supplier Details & Shopping Page
// ==========================================
router.get('/supplier/:id', async (req, res) => {
    try {
        const supplierId = req.params.id;
        const contractorId = req.signedCookies.userId;
        
        const preSelectedProjectId = req.query.projectId; 

        // 1. 獲取供應商詳細資料
        const [supplierRows] = await pool.execute('SELECT * FROM Suppliers WHERE SupplierID = ?', [supplierId]);
        const supplier = supplierRows[0];

        if (!supplier) {
            return res.redirect('/contractor/suppliers');
        }

        // 2. 獲取該供應商販售的材料
        const [materials] = await pool.execute(`
            SELECT M.MaterialID, M.MaterialName, U.UnitName, C.CategoryName, SM.PricePerUnit, SM.AvailableStock
            FROM SupplierMaterial SM
            JOIN Materials M ON SM.MaterialID = M.MaterialID
            LEFT JOIN Units U ON M.UnitID = U.UnitID
            LEFT JOIN Categories C ON M.CategoryID = C.CategoryID
            WHERE SM.SupplierID = ?
        `, [supplierId]);

        // 3. 獲取承包商的進行中專案
        const [projects] = await pool.execute(
            'SELECT ProjectID, ProjectName FROM Projects WHERE ContractorID = ? AND Status != "Completed"', 
            [contractorId]
        );

        const projectsWithSelection = projects.map(p => ({
            ...p,
            isSelected: (p.ProjectID == preSelectedProjectId)
        }));

        const supplierData = {
            ...supplier,
            CompanyName: supplier.SupplierName || supplier.Name, 
            PhoneNumber: supplier.PhoneNumber || 'N/A',
            Email: supplier.Email || 'N/A',
            items: materials.map(m => ({
                id: m.MaterialID,
                name: m.MaterialName,
                category: m.CategoryName || 'General',
                unit: m.UnitName || 'unit',
                price: m.PricePerUnit,
                stock: m.AvailableStock
            }))
        };

        await renderWithLayout(req, res, 'supplier_details', {
            title: `Purchase from ${supplierData.CompanyName}`,
            supplier: supplierData,
            projects: projectsWithSelection
        });

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/suppliers');
    }
});

// ==========================================
// 7. 處理訂單送出 (POST) + 自動發送通知
// ==========================================
router.post('/supplier/:id/create-order', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const supplierId = req.params.id;
        const contractorId = req.signedCookies.userId;
        const { project_id, delivery_date, cart_data } = req.body;

        const items = JSON.parse(cart_data);
        
        if (!items || items.length === 0) {
            throw new Error('Cart is empty');
        }

        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.qty), 0);

        // 1. 建立 PurchaseOrder
        const [poResult] = await conn.execute(
            'INSERT INTO PurchaseOrder (ContractorID, ProjectID, SupplierID, TotalAmount, Status, OrderDate) VALUES (?, ?, ?, ?, ?, NOW())',
            [contractorId, project_id, supplierId, totalAmount, 'Pending']
        );
        const poId = poResult.insertId;

        // 2. 建立 POItems
        for (const item of items) {
            await conn.execute(
                'INSERT INTO POItems (POID, MaterialID, Quantity, UnitPrice) VALUES (?, ?, ?, ?)',
                [poId, item.id, item.qty, item.price]
            );
        }

        // 3. ★★★ 觸發點：交易完成，發送通知 ★★★
        await conn.execute(
            'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
            [
                contractorId, 
                'Order Created Successfully', 
                `Order #${poId} for project has been placed. Total: $${totalAmount.toLocaleString()}`,
                `/contractor/projects/${project_id}`
            ]
        );

        await conn.commit();
        res.redirect(`/contractor/projects/${project_id}`); 

    } catch (err) {
        await conn.rollback();
        console.error("Transaction Error:", err);
        res.redirect(`/contractor/supplier/${req.params.id}?error=TransactionFailed`);
    } finally {
        conn.release();
    }
});

// ==========================================
// 8. Transaction History (Orders)
// ==========================================
router.get('/orders', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        
        const sql = `
            SELECT PO.*, S.SupplierName as SupplierName, P.ProjectName
            FROM PurchaseOrder PO
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            JOIN Projects P ON PO.ProjectID = P.ProjectID
            WHERE PO.ContractorID = ?
            ORDER BY PO.OrderDate DESC
        `;
        const [rawTransactions] = await pool.execute(sql, [contractorId]);

        const groups = {};
        rawTransactions.forEach(t => {
            if (!groups[t.SupplierName]) {
                groups[t.SupplierName] = { supplierName: t.SupplierName, totalSpent: 0, transactions: [] };
            }
            groups[t.SupplierName].totalSpent += parseFloat(t.TotalAmount);
            groups[t.SupplierName].transactions.push({
                TransactionDate: t.OrderDate.toISOString().split('T')[0],
                MaterialName: `Order #${t.POID} - ${t.ProjectName || 'General'}`,
                CategoryName: 'Mixed Materials',
                Quantity: '-', 
                PricePerUnit: '-',
                TotalPrice: t.TotalAmount
            });
        });

        await renderWithLayout(req, res, 'contractor_transactions', {
            title: 'Orders',
            groups: Object.values(groups)
        });

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/dashboard');
    }
});

// ==========================================
// 9. Notifications Center (通知列表)
// ==========================================
router.get('/notifications', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        
        // 獲取所有通知，最新的在上面
        const [notifications] = await pool.execute(
            'SELECT * FROM Notifications WHERE ContractorID = ? ORDER BY CreatedAt DESC', 
            [contractorId]
        );

        // 格式化日期
        const formattedNotifications = notifications.map(n => ({
            ...n,
            Time: n.CreatedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        }));

        await renderWithLayout(req, res, 'notifications', {
            title: 'Notifications',
            notifications: formattedNotifications
        });

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/dashboard');
    }
});

// 點擊單則通知 (標記已讀並跳轉)
router.get('/notifications/read/:id', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const contractorId = req.signedCookies.userId;

        // 1. 獲取該通知的 Link
        const [rows] = await pool.execute('SELECT Link FROM Notifications WHERE NotificationID = ? AND ContractorID = ?', [notificationId, contractorId]);
        
        // 2. 標記為已讀
        await pool.execute('UPDATE Notifications SET IsRead = 1 WHERE NotificationID = ?', [notificationId]);

        // 3. 跳轉
        if (rows.length > 0 && rows[0].Link) {
            res.redirect(rows[0].Link);
        } else {
            res.redirect('/contractor/notifications');
        }
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/notifications');
    }
});

// 標記全部已讀
router.post('/notifications/mark-all-read', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        await pool.execute('UPDATE Notifications SET IsRead = 1 WHERE ContractorID = ?', [contractorId]);
        res.redirect('/contractor/notifications');
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/notifications');
    }
});

// ==========================================
// 10. Edit Profile (編輯個人資料)
// ==========================================
router.get('/profile', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const [users] = await pool.execute('SELECT * FROM Contractors WHERE ContractorID = ?', [contractorId]);
        
        await renderWithLayout(req, res, 'profile', {
            title: 'Edit Profile',
            user: users[0],
            success: req.query.success,
            error: req.query.error
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/dashboard');
    }
});

router.post('/profile/update', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const { name, phone, address, password, confirm_password } = req.body;

        // 驗證密碼 (如果有填寫)
        if (password && password !== confirm_password) {
            return res.redirect('/contractor/profile?error=Passwords do not match');
        }

        let sql = 'UPDATE Contractors SET Name = ?, PhoneNumber = ?, Address = ?';
        let params = [name, phone, address];

        // 如果使用者有輸入新密碼才更新密碼
        if (password) {
            sql += ', Password = ?';
            params.push(password);
        }

        sql += ' WHERE ContractorID = ?';
        params.push(contractorId);

        await pool.execute(sql, params);

        // 更新 Cookie 中的名稱
        res.cookie('username', name, { signed: true });

        res.redirect('/contractor/profile?success=Profile updated successfully');

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/profile?error=Update failed');
    }
});

module.exports = router;