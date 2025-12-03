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

            // 2. 抓取未讀通知數量
            try {
                const [notifResult] = await pool.execute(
                    'SELECT COUNT(*) as count FROM Notifications WHERE ContractorID = ? AND IsRead = 0',
                    [contractorId]
                );
                unreadCount = notifResult[0].count;
            } catch (e) {
                // console.warn("Notifications table might not exist.");
            }
        }

        let viewPath = viewName;
        if (!viewName.includes('/')) {
            viewPath = `contractor/${viewName}`;
        }
        if (!viewPath.endsWith('.hjs')) {
            viewPath += '.hjs';
        }

        res.render(viewPath, data, (err, html) => {
            if (err) {
                console.error(`Error rendering view ${viewPath}:`, err);
                return res.status(500).send(`Template Error: ${err.message}`);
            }

            res.render('layout.hjs', {
                ...data,
                content: html,
                contractorName: currentUser.Name,
                contractorEmail: currentUser.Email,
                contractorPhone: currentUser.PhoneNumber,
                contractorAddress: currentUser.Address,
                notificationCount: unreadCount,
                cartItemCount: (req.signedCookies.shoppingCart || []).length,
                [`is${viewName.replace('contractor/', '').charAt(0).toUpperCase() + viewName.replace('contractor/', '').slice(1)}`]: true
            });
        });
    } catch (err) {
        console.error("Render Helper Error:", err);
        res.status(500).send("Internal Server Error");
    }
};

// ====================================================
// Helper: 狀態顏色對照 (Projects用)
// ====================================================
const getStatusMeta = (status) => {
    switch (status) {
        case 'In Progress': return { class: 'bg-amber-50 text-amber-600 border-amber-200', label: 'In Progress' };
        case 'Completed':   return { class: 'bg-green-50 text-green-600 border-green-200', label: 'Completed' };
        case 'On Hold':     return { class: 'bg-red-50 text-red-600 border-red-200', label: 'On Hold' };
        default:            return { class: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Planning' };
    }
};

// ==========================================
// 1. Dashboard (儀表板)
// ==========================================
router.get('/dashboard', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;

        const [spendResult] = await pool.execute(
            'SELECT SUM(TotalAmount) as total FROM PurchaseOrder WHERE ContractorID = ?',
            [contractorId]
        );
        const totalSpent = (spendResult[0].total || 0).toLocaleString();

        const [activeOrderResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM PurchaseOrder WHERE ContractorID = ? AND Status != "Completed" AND Status != "Delivered"',
            [contractorId]
        );
        const activeOrdersCount = activeOrderResult[0].count;

        const [activeProjectResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM Projects WHERE ContractorID = ? AND Status != "Completed"',
            [contractorId]
        );
        const activeProjectsCount = activeProjectResult[0].count;

        const [recentOrders] = await pool.execute(`
            SELECT PO.TotalAmount, PO.Status, P.ProjectName, S.SupplierName as SupplierName
            FROM PurchaseOrder PO
            JOIN Projects P ON PO.ProjectID = P.ProjectID
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            WHERE PO.ContractorID = ?
            ORDER BY PO.OrderDate DESC LIMIT 5
        `, [contractorId]);

        const [topSuppliers] = await pool.execute(`SELECT * FROM Suppliers LIMIT 3`);

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
// 2. Suppliers List (供應商列表)
// ==========================================
router.get('/suppliers', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        const searchType = req.query.type || 'supplier';

        let sql = 'SELECT * FROM Suppliers';
        let params = [];

        if (searchQuery) {
            if (searchType === 'material') {
                sql = `SELECT DISTINCT S.*, M.MaterialName as MatchedMaterial
                       FROM Suppliers S
                       JOIN SupplierMaterial SM ON S.SupplierID = SM.SupplierID
                       JOIN Materials M ON SM.MaterialID = M.MaterialID
                       WHERE M.MaterialName LIKE ?`;
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
// 3. Projects List (專案列表)
// ==========================================
router.get('/projects', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;

        const sql = `
            SELECT P.*, COALESCE(SUM(PO.TotalAmount), 0) as TotalSpent
            FROM Projects P
            LEFT JOIN PurchaseOrder PO ON P.ProjectID = PO.ProjectID
            WHERE P.ContractorID = ?
            GROUP BY P.ProjectID
            ORDER BY P.StartDate DESC
        `;

        const [projects] = await pool.execute(sql, [contractorId]);

        const formattedProjects = projects.map(p => {
            const budget = parseFloat(p.Budget) || 0;
            const spent = parseFloat(p.TotalSpent) || 0;
            const percentage = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
            const statusMeta = getStatusMeta(p.Status);

            return {
                ...p,
                FormattedStartDate: p.StartDate ? p.StartDate.toISOString().split('T')[0] : '-',
                FormattedBudget: budget.toLocaleString(),
                FormattedSpent: spent.toLocaleString(),
                ProgressPercent: percentage,
                StatusClass: statusMeta.class,
                StatusLabel: statusMeta.label
            };
        });

        await renderWithLayout(req, res, 'projects', {
            title: 'Projects',
            projects: formattedProjects
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

router.post('/projects/add', async (req, res) => {
    try {
        const { projectName, description, location, status, startDate, endDate, budget, clientName, clientContact } = req.body;
        const contractorId = req.signedCookies.userId;

        const [result] = await pool.execute(
            `INSERT INTO Projects (ContractorID, ProjectName, Description, Location, Status, StartDate, EndDate, Budget, ClientName, ClientContact) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [contractorId, projectName, description, location, status, startDate, endDate, budget || 0, clientName, clientContact]
        );

        // 建立專案時發送通知
        try {
            await pool.execute(
                'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                [contractorId, 'Project Created', `Project "${projectName}" has been successfully created.`, `/contractor/projects/${result.insertId}`]
            );
        } catch (e) { console.warn("Notif Error", e); }

        res.redirect('/contractor/projects');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating project');
    }
});

// ==========================================
// 4. Project Details (專案詳情 + 工項)
// ==========================================
router.get('/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;

        // 1. 取得專案基本資料 & 總花費
        const [projectRows] = await pool.execute(`
            SELECT P.*, COALESCE(SUM(PO.TotalAmount), 0) as TotalSpent
            FROM Projects P
            LEFT JOIN PurchaseOrder PO ON P.ProjectID = PO.ProjectID
            WHERE P.ProjectID = ?
            GROUP BY P.ProjectID
        `, [projectId]);

        if (projectRows.length === 0) return res.redirect('/contractor/projects');

        const p = projectRows[0];
        const budget = parseFloat(p.Budget) || 0;
        const spent = parseFloat(p.TotalSpent) || 0;
        const percentage = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
        const statusMeta = getStatusMeta(p.Status);

        const projectData = {
            ...p,
            RawStartDate: p.StartDate ? p.StartDate.toISOString().split('T')[0] : '',
            RawEndDate: p.EndDate ? p.EndDate.toISOString().split('T')[0] : '',
            FormattedStartDate: p.StartDate ? p.StartDate.toISOString().split('T')[0] : '-',
            FormattedBudget: budget.toLocaleString(),
            FormattedSpent: spent.toLocaleString(),
            ProgressPercent: percentage,
            StatusClass: statusMeta.class,
            StatusLabel: statusMeta.label,
            isPlanning: p.Status === 'Planning',
            isInProgress: p.Status === 'In Progress',
            isCompleted: p.Status === 'Completed',
            isOnHold: p.Status === 'On Hold'
        };

        // 2. 取得該專案的所有訂單 (歷史紀錄用)
        const [orders] = await pool.execute(`
            SELECT PO.POID, PO.Status, PO.OrderDate, PO.TotalAmount, PO.WorkItemID, S.SupplierName
            FROM PurchaseOrder PO
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            WHERE PO.ProjectID = ?
            ORDER BY PO.OrderDate DESC
        `, [projectId]);
        
        // 格式化訂單日期
        orders.forEach(order => {
            if(order.OrderDate) order.OrderDate = order.OrderDate.toISOString().split('T')[0];
            order.TotalAmount = parseFloat(order.TotalAmount).toLocaleString();
        });

        // 3. 取得工項列表
        const [workItems] = await pool.execute('SELECT * FROM WorkItems WHERE ProjectID = ? ORDER BY CreatedAt DESC', [projectId]);

        // 為每個工項抓取已購買的材料
        for (let item of workItems) {
            // 格式化日期
            if(item.StartDate) item.StartDate = item.StartDate.toISOString().split('T')[0];
            if(item.EndDate) item.EndDate = item.EndDate.toISOString().split('T')[0];

            // 查詢關聯到此 WorkItemID 的訂單細項 (POItems)
            const [materials] = await pool.execute(`
                SELECT 
                    M.MaterialName, 
                    POI.Quantity, 
                    POI.UnitPrice, 
                    (POI.Quantity * POI.UnitPrice) as TotalPrice,
                    U.UnitName as Unit,
                    S.SupplierName,
                    PO.POID,
                    PO.Status
                FROM PurchaseOrder PO
                JOIN POItems POI ON PO.POID = POI.POID
                JOIN Materials M ON POI.MaterialID = M.MaterialID
                LEFT JOIN Units U ON M.UnitID = U.UnitID
                JOIN Suppliers S ON PO.SupplierID = S.SupplierID
                WHERE PO.WorkItemID = ?
            `, [item.WorkItemID]);
            
            // 處理數字顯示
            materials.forEach(mat => {
                mat.TotalPrice = parseFloat(mat.TotalPrice).toLocaleString();
            });

            item.Materials = materials; // 將材料陣列掛載到工項物件上
        }

        await renderWithLayout(req, res, 'project_details', {
            title: p.ProjectName,
            project: projectData,
            orders: orders,
            workItems: workItems,
            hasWorkItems: workItems.length > 0
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/projects');
    }
});

// ==========================================
// ★★★ 編輯專案 (包含狀態變更通知) ★★★
// ==========================================
router.post('/projects/edit/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        const contractorId = req.signedCookies.userId;
        const { projectName, description, location, status, startDate, endDate, budget, clientName, clientContact } = req.body;

        // 1. 先抓取舊的狀態，用來比對是否有改變
        const [oldRows] = await pool.execute('SELECT ProjectName, Status FROM Projects WHERE ProjectID = ?', [projectId]);
        const oldStatus = oldRows.length > 0 ? oldRows[0].Status : null;
        const oldName = oldRows.length > 0 ? oldRows[0].ProjectName : projectName;

        // 2. 執行更新
        await pool.execute(`
            UPDATE Projects SET ProjectName=?, Description=?, Location=?, Status=?, StartDate=?, EndDate=?, Budget=?, ClientName=?, ClientContact=?
            WHERE ProjectID=?
        `, [projectName, description, location, status, startDate, endDate, budget, clientName, clientContact, projectId]);

        // 3. 偵測狀態改變並發送通知
        if (oldStatus && oldStatus !== status) {
            try {
                await pool.execute(
                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                    [
                        contractorId, 
                        'Project Status Update', 
                        `Project "${oldName}" status has changed from "${oldStatus}" to "${status}".`, 
                        `/contractor/projects/${projectId}`
                    ]
                );
            } catch (e) { 
                console.warn("Notification Error:", e.message); 
            }
        }

        res.redirect(`/contractor/projects/${projectId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating project');
    }
});

// 刪除專案 (Transaction)
router.post('/projects/delete/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const projectId = req.params.id;
        await conn.beginTransaction();
        await conn.execute('DELETE FROM POItems WHERE POID IN (SELECT POID FROM PurchaseOrder WHERE ProjectID = ?)', [projectId]);
        await conn.execute('DELETE FROM PurchaseOrder WHERE ProjectID = ?', [projectId]);
        await conn.execute('DELETE FROM WorkItems WHERE ProjectID = ?', [projectId]);
        await conn.execute('DELETE FROM Projects WHERE ProjectID = ?', [projectId]);
        await conn.commit();
        res.redirect('/contractor/projects');
    } catch (err) {
        await conn.rollback();
        console.error("Delete Project Error:", err);
        res.status(500).send('Error deleting project');
    } finally {
        conn.release();
    }
});

// 新增工項
router.post('/projects/:id/workitem/add', async (req, res) => {
    try {
        const projectId = req.params.id;
        const contractorId = req.signedCookies.userId;
        const { name, description, status, estimatedCost, startDate, endDate, notes } = req.body;
        await pool.execute(
            `INSERT INTO WorkItems (ProjectID, Name, Description, Status, EstimatedCost, StartDate, EndDate, Notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [projectId, name, description, status, estimatedCost || 0, startDate, endDate, notes]
        );

        // 新增工項時發送通知
        try {
            await pool.execute(
                'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                [contractorId, 'Work Item Added', `New work item "${name}" added to the project.`, `/contractor/projects/${projectId}`]
            );
        } catch (e) { console.warn("Notif Error", e); }

        res.redirect(`/contractor/projects/${projectId}`);
    } catch (err) {
        console.error("Add Work Item Error:", err);
        res.status(500).send('Error adding work item');
    }
});

// 刪除工項
router.post('/projects/:projectId/workitem/delete/:workItemId', async (req, res) => {
    try {
        const { projectId, workItemId } = req.params;
        await pool.execute('DELETE FROM WorkItems WHERE WorkItemID = ?', [workItemId]);
        res.redirect(`/contractor/projects/${projectId}`);
    } catch (err) {
        console.error("Delete Work Item Error:", err);
        res.status(500).send('Error deleting work item');
    }
});

// ==========================================
// 5. Create PO (選擇供應商)
// ==========================================
router.get('/projects/:id/create-po', async (req, res) => {
    try {
        const projectId = req.params.id;
        const searchQuery = req.query.q || '';
        const searchType = req.query.type || 'supplier';
        const workItemId = req.query.workItemId;

        const [projectRows] = await pool.execute('SELECT * FROM Projects WHERE ProjectID = ?', [projectId]);

        let sql = 'SELECT * FROM Suppliers';
        let params = [];

        if (searchQuery) {
            if (searchType === 'material') {
                sql = `SELECT DISTINCT S.*, M.MaterialName as MatchedMaterial FROM Suppliers S JOIN SupplierMaterial SM ON S.SupplierID = SM.SupplierID JOIN Materials M ON SM.MaterialID = M.MaterialID WHERE M.MaterialName LIKE ?`;
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

        let activeWorkItemName = '';
        if (workItemId) {
             const [wiRows] = await pool.execute('SELECT Name FROM WorkItems WHERE WorkItemID = ?', [workItemId]);
             if (wiRows.length > 0) activeWorkItemName = wiRows[0].Name;
        }

        await renderWithLayout(req, res, 'create_po', {
            title: 'Select Supplier',
            project: projectRows[0],
            suppliers: suppliersFixed,
            searchQuery,
            searchType: searchType === 'material' ? 'Material' : 'Supplier Name',
            isTypeSupplier: searchType === 'supplier',
            isTypeMaterial: searchType === 'material',
            workItemId,
            activeWorkItemName 
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
        const preSelectedWorkItemId = req.query.workItemId;
        const searchQuery = req.query.q || '';

        const [supplierRows] = await pool.execute('SELECT * FROM Suppliers WHERE SupplierID = ?', [supplierId]);
        const supplier = supplierRows[0];

        if (!supplier) return res.redirect('/contractor/suppliers');

        let sql = `
            SELECT M.MaterialID, M.MaterialName, U.UnitName, C.CategoryName, SM.PricePerUnit, SM.AvailableStock
            FROM SupplierMaterial SM
            JOIN Materials M ON SM.MaterialID = M.MaterialID
            LEFT JOIN Units U ON M.UnitID = U.UnitID
            LEFT JOIN Categories C ON M.CategoryID = C.CategoryID
            WHERE SM.SupplierID = ?
        `;
        let params = [supplierId];

        if (searchQuery) {
            sql += ' AND (M.MaterialName LIKE ? OR C.CategoryName LIKE ?)';
            params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        }

        const [materials] = await pool.execute(sql, params);

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

        const [allWorkItems] = await pool.execute(`
            SELECT WorkItemID, ProjectID, Name 
            FROM WorkItems 
            WHERE ProjectID IN (SELECT ProjectID FROM Projects WHERE ContractorID = ?)
            ORDER BY Name ASC
        `, [contractorId]);

        await renderWithLayout(req, res, 'supplier_details', {
            title: `Purchase from ${supplierData.CompanyName}`,
            supplier: supplierData,
            projects: projectsWithSelection,
            searchQuery,
            preSelectedProjectId,
            preSelectedWorkItemId,
            allWorkItemsJSON: JSON.stringify(allWorkItems)
        });

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/suppliers');
    }
});

// ==========================================
// 7. Materials Catalog (材料列表)
// ==========================================
router.get('/materials', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        const categoryId = req.query.category || '';
        const { projectId, workItemId } = req.query;

        const [categories] = await pool.execute('SELECT * FROM Categories');
        const categoriesWithSelect = categories.map(c => ({ ...c, isSelected: c.CategoryID == categoryId }));

        let sql = `
            SELECT M.MaterialID, M.MaterialName, C.CategoryName, U.UnitName, 
                   (SELECT COUNT(*) FROM SupplierMaterial SM WHERE SM.MaterialID = M.MaterialID) as SupplierCount
            FROM Materials M
            LEFT JOIN Categories C ON M.CategoryID = C.CategoryID
            LEFT JOIN Units U ON M.UnitID = U.UnitID
            WHERE 1=1 
        `;
        let params = [];

        if (searchQuery) {
            sql += ' AND (M.MaterialName LIKE ? OR M.MaterialID LIKE ?)';
            params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        }
        if (categoryId) {
            sql += ' AND C.CategoryID = ?';
            params.push(categoryId);
        }

        const [materials] = await pool.execute(sql, params);

        let activeWorkItemName = '';
        if (workItemId) {
            const [wiRows] = await pool.execute('SELECT Name FROM WorkItems WHERE WorkItemID = ?', [workItemId]);
            if (wiRows.length > 0) activeWorkItemName = wiRows[0].Name;
        }

        await renderWithLayout(req, res, 'materials', {
            title: 'Materials Catalog',
            materials,
            categories: categoriesWithSelect,
            searchQuery,
            totalCount: materials.length,
            queryParams: { projectId, workItemId },
            activeWorkItemName
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ==========================================
// 8. Material Detail Page
// ==========================================
router.get('/materials/:id', async (req, res) => {
    try {
        const materialId = req.params.id;
        const { projectId, workItemId } = req.query;

        const [matRows] = await pool.execute(`
            SELECT M.*, C.CategoryName, U.UnitName 
            FROM Materials M
            LEFT JOIN Categories C ON M.CategoryID = C.CategoryID
            LEFT JOIN Units U ON M.UnitID = U.UnitID
            WHERE M.MaterialID = ?
        `, [materialId]);

        if (matRows.length === 0) return res.redirect('/contractor/materials');
        const material = matRows[0];

        const [suppliers] = await pool.execute(`
            SELECT S.SupplierID, S.SupplierName, S.Address, S.Rating, S.PhoneNumber, S.Email, S.Description,
                   SM.PricePerUnit, SM.AvailableStock
            FROM SupplierMaterial SM
            JOIN Suppliers S ON SM.SupplierID = S.SupplierID
            WHERE SM.MaterialID = ?
            ORDER BY SM.PricePerUnit ASC
        `, [materialId]);

        const suppliersWithMeta = suppliers.map(s => ({
            ...s,
            TargetMatName: material.MaterialName,
            TargetMatID: material.MaterialID
        }));

        await renderWithLayout(req, res, 'material_details', {
            title: material.MaterialName,
            material,
            suppliers: suppliersWithMeta,
            hasSuppliers: suppliers.length > 0,
            projectId,
            workItemId
        });

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/materials');
    }
});

// ==========================================
// 9. Transaction History (Orders) - ★★★ 支援專案篩選與進度條 ★★★
// ==========================================
router.get('/orders', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const filterProjectId = req.query.projectId; // 取得前端傳來的篩選條件
        
        // 1. 取得專案列表 (用 StartDate 排序，避免 CreatedAt 不存在)
        const [projects] = await pool.execute(
            'SELECT ProjectID, ProjectName FROM Projects WHERE ContractorID = ? ORDER BY StartDate DESC',
            [contractorId]
        );

        // 標記目前被選中的專案
        const projectsWithSelect = projects.map(p => ({
            ...p,
            selected: (p.ProjectID == filterProjectId) ? 'selected' : ''
        }));

        // 2. 準備訂單查詢 SQL (加入 TrackingNumber, EstimatedArrival)
        let sql = `
            SELECT PO.*, S.SupplierName as SupplierName, P.ProjectName
            FROM PurchaseOrder PO
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            JOIN Projects P ON PO.ProjectID = P.ProjectID
            WHERE PO.ContractorID = ?
        `;
        let params = [contractorId];

        // 如果有選專案，加入篩選條件
        if (filterProjectId) {
            sql += ' AND PO.ProjectID = ?';
            params.push(filterProjectId);
        }

        sql += ' ORDER BY PO.OrderDate DESC';

        const [rawTransactions] = await pool.execute(sql, params);

        // 3. Helper: 計算進度條狀態
        const getProgress = (status) => {
            switch(status) {
                case 'Pending': return { width: '10%', step: 1 };
                case 'Processing': return { width: '50%', step: 2 };
                case 'Shipped': return { width: '80%', step: 3 };
                case 'Delivered': return { width: '100%', step: 4 };
                default: return { width: '0%', step: 0 };
            }
        };

        // 4. 整理資料結構
        const orders = rawTransactions.map(t => {
            const progress = getProgress(t.Status);
            return {
                ...t,
                FormattedDate: t.OrderDate.toISOString().split('T')[0], // 訂單日期
                FormattedArrival: t.EstimatedArrival ? t.EstimatedArrival.toISOString().split('T')[0] : 'TBD', // 預計抵達
                ProgressWidth: progress.width,
                CurrentStep: progress.step,
                IsPending: t.Status === 'Pending',
                IsProcessing: t.Status === 'Processing',
                IsShipped: t.Status === 'Shipped',
                IsDelivered: t.Status === 'Delivered',
                FormattedTotal: parseFloat(t.TotalAmount).toLocaleString()
            };
        });

        await renderWithLayout(req, res, 'orders', { 
            title: 'Track Orders',
            orders: orders,
            projects: projectsWithSelect, // 傳遞專案列表給前端下拉選單
            filterProjectId
        });

    } catch (err) {
        console.error("Orders Page Error:", err);
        res.redirect('/contractor/dashboard');
    }
});

// ==========================================
// ★★★ 模擬物流狀態推進 (Demo 用) + 通知功能 ★★★
// ==========================================
router.post('/orders/:id/simulate-status', async (req, res) => {
    try {
        const poId = req.params.id;
        const contractorId = req.signedCookies.userId;
        
        // 1. 查出目前狀態
        const [rows] = await pool.execute('SELECT Status FROM PurchaseOrder WHERE POID = ?', [poId]);
        if (rows.length === 0) return res.redirect('/contractor/orders');
        
        const currentStatus = rows[0].Status;
        let nextStatus = currentStatus;
        let trackingNum = null;

        // 2. 定義狀態流程
        switch (currentStatus) {
            case 'Pending':
                nextStatus = 'Processing'; 
                break;
            case 'Processing':
                nextStatus = 'Shipped';    
                trackingNum = 'TN-' + Math.floor(100000 + Math.random() * 900000); 
                break;
            case 'Shipped':
                nextStatus = 'Delivered';  
                break;
            default:
                break; 
        }

        // 3. 更新資料庫
        let sql = 'UPDATE PurchaseOrder SET Status = ?';
        let params = [nextStatus];

        if (trackingNum) {
            sql += ', TrackingNumber = ?';
            params.push(trackingNum);
        }

        sql += ' WHERE POID = ?';
        params.push(poId);

        await pool.execute(sql, params);

        // ★★★ 物流狀態變更時發送通知 ★★★
        if (nextStatus !== currentStatus) {
            try {
                await pool.execute(
                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                    [contractorId, 'Shipment Update', `Order #PO-${poId} status updated to ${nextStatus}.`, `/contractor/orders#order-${poId}`]
                );
            } catch (e) { console.warn("Notif Error", e); }
        }

        // 導回來源頁面
        const referer = req.get('Referer');
        if (referer) {
            res.redirect(referer);
        } else {
            res.redirect('/contractor/orders');
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating status');
    }
});

// ==========================================
// 10. Notifications Center
// ==========================================
router.get('/notifications', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const [notifications] = await pool.execute(
            'SELECT * FROM Notifications WHERE ContractorID = ? ORDER BY CreatedAt DESC', 
            [contractorId]
        );

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

router.get('/notifications/read/:id', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const contractorId = req.signedCookies.userId;
        const [rows] = await pool.execute('SELECT Link FROM Notifications WHERE NotificationID = ? AND ContractorID = ?', [notificationId, contractorId]);
        await pool.execute('UPDATE Notifications SET IsRead = 1 WHERE NotificationID = ?', [notificationId]);

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
// 11. Edit Profile
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

        if (password && password !== confirm_password) {
            return res.redirect('/contractor/profile?error=Passwords do not match');
        }

        let sql = 'UPDATE Contractors SET Name = ?, PhoneNumber = ?, Address = ?';
        let params = [name, phone, address];

        if (password) {
            sql += ', Password = ?';
            params.push(password);
        }

        sql += ' WHERE ContractorID = ?';
        params.push(contractorId);

        await pool.execute(sql, params);
        res.cookie('username', name, { signed: true });
        res.redirect('/contractor/profile?success=Profile updated successfully');

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/profile?error=Update failed');
    }
});

// ==========================================
// 12. Shopping Cart System
// ==========================================

router.post('/cart/add', (req, res) => {
    try {
        const { project_id, work_item_id, delivery_date, cart_data, supplier_id, supplier_name } = req.body;
        const newItems = JSON.parse(cart_data);

        let currentCart = req.signedCookies.shoppingCart || [];

        const cartEntry = {
            supplierId: supplier_id,
            supplierName: supplier_name,
            projectId: project_id,
            workItemId: work_item_id || null, 
            deliveryDate: delivery_date,
            items: newItems,
            addedAt: new Date()
        };

        currentCart.push(cartEntry);
        res.cookie('shoppingCart', currentCart, { signed: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.redirect('/contractor/cart');

    } catch (err) {
        console.error("Add to cart error:", err);
        res.redirect('/contractor/suppliers');
    }
});

router.get('/cart', async (req, res) => {
    try {
        let cart = req.signedCookies.shoppingCart || [];
        let grandTotal = 0;
        cart.forEach(entry => {
            entry.subtotal = entry.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
            grandTotal += entry.subtotal;
        });

        await renderWithLayout(req, res, 'cart', {
            title: 'Shopping Cart',
            cart: cart,
            grandTotal: grandTotal,
            hasItems: cart.length > 0
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Cart Error');
    }
});

// ★★★ 修改版 Checkout：寫入預計抵達日期與初始狀態 ★★★
router.post('/cart/checkout', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const contractorId = req.signedCookies.userId;
        const cart = req.signedCookies.shoppingCart || [];

        if (cart.length === 0) throw new Error('Cart is empty');

        for (const entry of cart) {
            const totalAmount = entry.items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty)), 0);

            // ★★★ 修改：將 deliveryDate 寫入 EstimatedArrival，並將 Status 初始設為 'Pending' ★★★
            const [poResult] = await conn.execute(
                'INSERT INTO PurchaseOrder (ContractorID, ProjectID, WorkItemID, SupplierID, TotalAmount, Status, OrderDate, EstimatedArrival) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)',
                [contractorId, entry.projectId, entry.workItemId, entry.supplierId, totalAmount, 'Pending', entry.deliveryDate || null]
            );
            const poId = poResult.insertId;

            for (const item of entry.items) {
                await conn.execute(
                    'INSERT INTO POItems (POID, MaterialID, Quantity, UnitPrice) VALUES (?, ?, ?, ?)',
                    [poId, item.id, parseInt(item.qty), parseFloat(item.price)]
                );
            }

            try {
                await conn.execute(
                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                    [contractorId, 'Order Placed', `Order #${poId} to ${entry.supplierName} has been confirmed.`, `/contractor/orders`]
                );
            } catch (notifErr) {
                console.warn("Notification failed:", notifErr.message);
            }
        }

        await conn.commit();
        res.clearCookie('shoppingCart');
        res.redirect('/contractor/orders?success=CheckoutComplete');

    } catch (err) {
        await conn.rollback();
        console.error("Checkout Error:", err);
        res.redirect('/contractor/cart?error=TransactionFailed');
    } finally {
        conn.release();
    }
});

router.get('/cart/clear', (req, res) => {
    res.clearCookie('shoppingCart');
    res.redirect('/contractor/cart');
});

module.exports = router;