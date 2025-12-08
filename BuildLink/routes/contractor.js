const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const config = require('../config');
const pool = mysql.createPool(config.db);

// ====================================================
// Helper: 兩階段渲染
// ====================================================
const renderWithLayout = async (req, res, viewName, data) => {
    try {
        const contractorId = req.signedCookies.userId;
        let currentUser = { Name: 'Contractor', Email: '', Address: '', PhoneNumber: '' };
        let unreadCount = 0;

        if (contractorId) {
            const [users] = await pool.execute('SELECT * FROM Contractors WHERE ContractorID = ?', [contractorId]);
            if (users.length > 0) currentUser = users[0];

            try {
                const [notifResult] = await pool.execute(
                    'SELECT COUNT(*) as count FROM Notifications WHERE ContractorID = ? AND IsRead = 0',
                    [contractorId]
                );
                unreadCount = notifResult[0].count;
            } catch (e) { }
        }

        let viewPath = viewName;
        if (!viewName.includes('/')) viewPath = `contractor/${viewName}`;
        if (!viewPath.endsWith('.hjs')) viewPath += '.hjs';

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

// Helper: 狀態顏色
const getStatusMeta = (status) => {
    switch (status) {
        case 'In Progress': return { class: 'bg-amber-50 text-amber-600 border-amber-200', label: 'In Progress' };
        case 'Completed':   return { class: 'bg-green-50 text-green-600 border-green-200', label: 'Completed' };
        case 'On Hold':     return { class: 'bg-red-50 text-red-600 border-red-200', label: 'On Hold' };
        default:            return { class: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Planning' };
    }
};

// ==========================================
// 1. Dashboard
// ==========================================
router.get('/dashboard', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const [spendResult] = await pool.execute('SELECT SUM(TotalAmount) as total FROM PurchaseOrder WHERE ContractorID = ?', [contractorId]);
        const totalSpent = (spendResult[0].total || 0).toLocaleString();
        
        const [activeOrderResult] = await pool.execute('SELECT COUNT(*) as count FROM PurchaseOrder WHERE ContractorID = ? AND Status != "Completed" AND Status != "Delivered"', [contractorId]);
        const activeOrdersCount = activeOrderResult[0].count;

        const [activeProjectResult] = await pool.execute('SELECT COUNT(*) as count FROM Projects WHERE ContractorID = ? AND Status != "Completed"', [contractorId]);
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
            totalSpent, activeOrdersCount, activeProjectsCount, recentOrders, topSuppliers
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ==========================================
// 2. Suppliers
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
            isSupplier: true,
            MatchedMaterial: s.MatchedMaterial || null
        }));

        await renderWithLayout(req, res, 'suppliers', {
            title: 'Suppliers', suppliers, searchQuery,
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
        const [projects] = await pool.execute(`
            SELECT P.*, COALESCE(SUM(PO.TotalAmount), 0) as TotalSpent
            FROM Projects P
            LEFT JOIN PurchaseOrder PO ON P.ProjectID = PO.ProjectID
            WHERE P.ContractorID = ?
            GROUP BY P.ProjectID
            ORDER BY P.StartDate DESC
        `, [contractorId]);

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

        await renderWithLayout(req, res, 'projects', { title: 'Projects', projects: formattedProjects });
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
        
        try {
            await pool.execute(
                'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                [contractorId, 'Project Created', `Project "${projectName}" has been successfully created.`, `/contractor/projects/${result.insertId}`]
            );
        } catch (e) {}

        res.redirect('/contractor/projects');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error');
    }
});

// ==========================================
// 4. Project Details
// ==========================================
router.get('/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
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

        const [orders] = await pool.execute(`
            SELECT PO.POID, PO.Status, PO.OrderDate, PO.TotalAmount, PO.WorkItemID, S.SupplierName
            FROM PurchaseOrder PO
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            WHERE PO.ProjectID = ?
            ORDER BY PO.OrderDate DESC
        `, [projectId]);
        
        orders.forEach(order => {
            if(order.OrderDate) order.OrderDate = order.OrderDate.toISOString().split('T')[0];
            order.TotalAmount = parseFloat(order.TotalAmount).toLocaleString();
        });

        const [workItems] = await pool.execute('SELECT * FROM WorkItems WHERE ProjectID = ? ORDER BY CreatedAt DESC', [projectId]);

        for (let item of workItems) {
            if(item.StartDate) item.StartDate = item.StartDate.toISOString().split('T')[0];
            if(item.EndDate) item.EndDate = item.EndDate.toISOString().split('T')[0];

            const [materials] = await pool.execute(`
                SELECT M.MaterialName, POI.Quantity, POI.UnitPrice, (POI.Quantity * POI.UnitPrice) as TotalPrice,
                       U.UnitName as Unit, S.SupplierName, PO.POID, PO.Status
                FROM PurchaseOrder PO
                JOIN POItems POI ON PO.POID = POI.POID
                JOIN Materials M ON POI.MaterialID = M.MaterialID
                LEFT JOIN Units U ON M.UnitID = U.UnitID
                JOIN Suppliers S ON PO.SupplierID = S.SupplierID
                WHERE PO.WorkItemID = ?
            `, [item.WorkItemID]);
            
            materials.forEach(mat => mat.TotalPrice = parseFloat(mat.TotalPrice).toLocaleString());
            item.Materials = materials;
        }

        await renderWithLayout(req, res, 'project_details', {
            title: p.ProjectName, project: projectData, orders: orders, workItems: workItems, hasWorkItems: workItems.length > 0
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/projects');
    }
});

// 編輯專案 (包含狀態變更通知)
router.post('/projects/edit/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        const contractorId = req.signedCookies.userId;
        const { projectName, description, location, status, startDate, endDate, budget, clientName, clientContact } = req.body;

        const [oldRows] = await pool.execute('SELECT ProjectName, Status FROM Projects WHERE ProjectID = ?', [projectId]);
        const oldStatus = oldRows.length > 0 ? oldRows[0].Status : null;
        const oldName = oldRows.length > 0 ? oldRows[0].ProjectName : projectName;

        await pool.execute(`
            UPDATE Projects SET ProjectName=?, Description=?, Location=?, Status=?, StartDate=?, EndDate=?, Budget=?, ClientName=?, ClientContact=?
            WHERE ProjectID=?
        `, [projectName, description, location, status, startDate, endDate, budget, clientName, clientContact, projectId]);

        if (oldStatus && oldStatus !== status) {
            try {
                await pool.execute(
                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                    [contractorId, 'Project Status Update', `Project "${oldName}" status has changed from "${oldStatus}" to "${status}".`, `/contractor/projects/${projectId}`]
                );
            } catch (e) {}
        }
        res.redirect(`/contractor/projects/${projectId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error');
    }
});

// 刪除專案
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
        console.error(err);
        res.status(500).send('Error');
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

        try {
            await pool.execute(
                'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                [contractorId, 'Work Item Added', `New work item "${name}" added to the project.`, `/contractor/projects/${projectId}`]
            );
        } catch (e) {}

        res.redirect(`/contractor/projects/${projectId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error');
    }
});

// 刪除工項
router.post('/projects/:projectId/workitem/delete/:workItemId', async (req, res) => {
    try {
        const { projectId, workItemId } = req.params;
        await pool.execute('DELETE FROM WorkItems WHERE WorkItemID = ?', [workItemId]);
        res.redirect(`/contractor/projects/${projectId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error');
    }
});

// ==========================================
// 5. Create PO
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
            searchQuery, searchType: searchType === 'material' ? 'Material' : 'Supplier Name',
            isTypeSupplier: searchType === 'supplier', isTypeMaterial: searchType === 'material',
            workItemId, activeWorkItemName 
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/projects');
    }
});

// ==========================================
// 6. Supplier Details
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
        const [projects] = await pool.execute('SELECT ProjectID, ProjectName FROM Projects WHERE ContractorID = ? AND Status != "Completed"', [contractorId]);
        const projectsWithSelection = projects.map(p => ({ ...p, isSelected: (p.ProjectID == preSelectedProjectId) }));

        const supplierData = {
            ...supplier,
            CompanyName: supplier.SupplierName || supplier.Name,
            items: materials.map(m => ({
                id: m.MaterialID, name: m.MaterialName, category: m.CategoryName || 'General', unit: m.UnitName || 'unit', price: m.PricePerUnit, stock: m.AvailableStock
            }))
        };

        const [allWorkItems] = await pool.execute(`
            SELECT WorkItemID, ProjectID, Name FROM WorkItems 
            WHERE ProjectID IN (SELECT ProjectID FROM Projects WHERE ContractorID = ?) ORDER BY Name ASC
        `, [contractorId]);

        await renderWithLayout(req, res, 'supplier_details', {
            title: `Purchase from ${supplierData.CompanyName}`,
            supplier: supplierData, projects: projectsWithSelection, searchQuery,
            preSelectedProjectId, preSelectedWorkItemId, allWorkItemsJSON: JSON.stringify(allWorkItems)
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/suppliers');
    }
});

// ==========================================
// 7. Materials Catalog
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
            title: 'Materials Catalog', materials, categories: categoriesWithSelect, searchQuery, totalCount: materials.length, queryParams: { projectId, workItemId }, activeWorkItemName
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// ==========================================
// 8. Material Detail (注意：折線圖後端API已移除，前端canvas代碼也建議刪除)
// ==========================================
router.get('/materials/:id', async (req, res) => {
    try {
        const materialId = req.params.id;
        const { projectId, workItemId } = req.query;

        const [matRows] = await pool.execute(`
            SELECT M.*, C.CategoryName, U.UnitName FROM Materials M
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
            ...s, TargetMatName: material.MaterialName, TargetMatID: material.MaterialID
        }));

        await renderWithLayout(req, res, 'material_details', {
            title: material.MaterialName, material, suppliers: suppliersWithMeta, hasSuppliers: suppliers.length > 0, projectId, workItemId
        });
    } catch (err) {
        console.error(err);
        res.redirect('/contractor/materials');
    }
});

// ==========================================
// 9. Transaction History (Orders)
// ==========================================
router.get('/orders', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const filterProjectId = req.query.projectId; 
        
        const [projects] = await pool.execute(
            'SELECT ProjectID, ProjectName FROM Projects WHERE ContractorID = ? ORDER BY StartDate DESC',
            [contractorId]
        );

        const projectsWithSelect = projects.map(p => ({
            ...p,
            selected: (p.ProjectID == filterProjectId) ? 'selected' : ''
        }));

        let sql = `
            SELECT PO.*, S.SupplierName as SupplierName, P.ProjectName
            FROM PurchaseOrder PO
            JOIN Suppliers S ON PO.SupplierID = S.SupplierID
            JOIN Projects P ON PO.ProjectID = P.ProjectID
            WHERE PO.ContractorID = ?
        `;
        let params = [contractorId];

        if (filterProjectId) {
            sql += ' AND PO.ProjectID = ?';
            params.push(filterProjectId);
        }

        sql += ' ORDER BY PO.OrderDate DESC';

        const [rawTransactions] = await pool.execute(sql, params);

        const getProgress = (status) => {
            switch(status) {
                case 'Pending': return { width: '10%', step: 1 };
                case 'Processing': return { width: '50%', step: 2 };
                case 'Shipped': return { width: '80%', step: 3 };
                case 'Delivered': return { width: '100%', step: 4 };
                default: return { width: '0%', step: 0 };
            }
        };

        const orders = rawTransactions.map(t => {
            const progress = getProgress(t.Status);
            return {
                ...t,
                FormattedDate: t.OrderDate.toISOString().split('T')[0],
                FormattedArrival: t.EstimatedArrival ? t.EstimatedArrival.toISOString().split('T')[0] : 'TBD',
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
            projects: projectsWithSelect,
            filterProjectId
        });

    } catch (err) {
        console.error("Orders Page Error:", err);
        res.redirect('/contractor/dashboard');
    }
});

// ==========================================
// 10. Simulate Status
// ==========================================
router.post('/orders/:id/simulate-status', async (req, res) => {
    try {
        const poId = req.params.id;
        const contractorId = req.signedCookies.userId;
        
        const [rows] = await pool.execute('SELECT Status FROM PurchaseOrder WHERE POID = ?', [poId]);
        if (rows.length === 0) return res.redirect('/contractor/orders');
        
        const currentStatus = rows[0].Status;
        let nextStatus = currentStatus;
        let trackingNum = null;

        switch (currentStatus) {
            case 'Pending': nextStatus = 'Processing'; break;
            case 'Processing': nextStatus = 'Shipped'; trackingNum = 'TN-' + Math.floor(100000 + Math.random() * 900000); break;
            case 'Shipped': nextStatus = 'Delivered'; break;
            default: break; 
        }

        let sql = 'UPDATE PurchaseOrder SET Status = ?';
        let params = [nextStatus];

        if (trackingNum) {
            sql += ', TrackingNumber = ?';
            params.push(trackingNum);
        }

        sql += ' WHERE POID = ?';
        params.push(poId);

        await pool.execute(sql, params);

        if (nextStatus !== currentStatus) {
            try {
                await pool.execute(
                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                    [contractorId, 'Shipment Update', `Order #PO-${poId} status updated to ${nextStatus}.`, `/contractor/orders#order-${poId}`]
                );
            } catch (e) { }
        }

        const referer = req.get('Referer');
        if (referer) res.redirect(referer);
        else res.redirect('/contractor/orders');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error');
    }
});

// ==========================================
// 11. Notifications / Profile
// ==========================================
router.get('/notifications', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const [notifications] = await pool.execute('SELECT * FROM Notifications WHERE ContractorID = ? ORDER BY CreatedAt DESC', [contractorId]);
        const formattedNotifications = notifications.map(n => ({
            ...n, Time: n.CreatedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        }));
        await renderWithLayout(req, res, 'notifications', { title: 'Notifications', notifications: formattedNotifications });
    } catch (err) { res.redirect('/contractor/dashboard'); }
});

router.get('/notifications/read/:id', async (req, res) => {
    try {
        const notificationId = req.params.id;
        const [rows] = await pool.execute('SELECT Link FROM Notifications WHERE NotificationID = ?', [notificationId]);
        await pool.execute('UPDATE Notifications SET IsRead = 1 WHERE NotificationID = ?', [notificationId]);
        if (rows.length > 0 && rows[0].Link) res.redirect(rows[0].Link);
        else res.redirect('/contractor/notifications');
    } catch (err) { res.redirect('/contractor/notifications'); }
});

router.post('/notifications/mark-all-read', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        await pool.execute('UPDATE Notifications SET IsRead = 1 WHERE ContractorID = ?', [contractorId]);
        res.redirect('/contractor/notifications');
    } catch (err) { res.redirect('/contractor/notifications'); }
});

router.get('/profile', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const [users] = await pool.execute('SELECT * FROM Contractors WHERE ContractorID = ?', [contractorId]);
        await renderWithLayout(req, res, 'profile', { title: 'Edit Profile', user: users[0], success: req.query.success, error: req.query.error });
    } catch (err) { res.redirect('/contractor/dashboard'); }
});

router.post('/profile/update', async (req, res) => {
    try {
        const contractorId = req.signedCookies.userId;
        const { name, phone, address, password, confirm_password } = req.body;
        if (password && password !== confirm_password) return res.redirect('/contractor/profile?error=Passwords do not match');
        let sql = 'UPDATE Contractors SET Name = ?, PhoneNumber = ?, Address = ?';
        let params = [name, phone, address];
        if (password) { sql += ', Password = ?'; params.push(password); }
        sql += ' WHERE ContractorID = ?';
        params.push(contractorId);
        await pool.execute(sql, params);
        res.cookie('username', name, { signed: true });
        res.redirect('/contractor/profile?success=Profile updated successfully');
    } catch (err) { res.redirect('/contractor/profile?error=Update failed'); }
});

// ==========================================
// 12. Cart & Checkout (含專案/工項雙重預算預警)
// ==========================================
router.post('/cart/add', (req, res) => {
    try {
        const { project_id, work_item_id, delivery_date, cart_data, supplier_id, supplier_name } = req.body;
        const newItems = JSON.parse(cart_data);
        let currentCart = req.signedCookies.shoppingCart || [];
        const cartEntry = {
            supplierId: supplier_id, supplierName: supplier_name, projectId: project_id,
            workItemId: work_item_id || null, deliveryDate: delivery_date, items: newItems, addedAt: new Date()
        };
        currentCart.push(cartEntry);
        res.cookie('shoppingCart', currentCart, { signed: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.redirect('/contractor/cart');
    } catch (err) { res.redirect('/contractor/suppliers'); }
});

router.get('/cart', async (req, res) => {
    try {
        let cart = req.signedCookies.shoppingCart || [];
        let grandTotal = 0;
        cart.forEach(entry => {
            entry.subtotal = entry.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
            grandTotal += entry.subtotal;
        });
        await renderWithLayout(req, res, 'cart', { title: 'Shopping Cart', cart, grandTotal, hasItems: cart.length > 0 });
    } catch (err) { res.status(500).send('Cart Error'); }
});

// ★★★ 智慧預算預警版 Checkout (包含工項 + 專案雙重檢查) ★★★
router.post('/cart/checkout', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const contractorId = req.signedCookies.userId;
        const cart = req.signedCookies.shoppingCart || [];

        if (cart.length === 0) throw new Error('Cart is empty');

        for (const entry of cart) {
            // 1. 計算總額
            const totalAmount = entry.items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty)), 0);

            // 2. 寫入 PurchaseOrder
            const [poResult] = await conn.execute(
                'INSERT INTO PurchaseOrder (ContractorID, ProjectID, WorkItemID, SupplierID, TotalAmount, Status, OrderDate, EstimatedArrival) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)',
                [contractorId, entry.projectId, entry.workItemId, entry.supplierId, totalAmount, 'Pending', entry.deliveryDate || null]
            );
            const poId = poResult.insertId;

            // 3. 寫入 POItems
            for (const item of entry.items) {
                await conn.execute(
                    'INSERT INTO POItems (POID, MaterialID, Quantity, UnitPrice) VALUES (?, ?, ?, ?)',
                    [poId, item.id, parseInt(item.qty), parseFloat(item.price)]
                );
            }

            // 4. 通知：訂單建立
            try {
                await conn.execute(
                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                    [contractorId, 'Order Placed', `Order #${poId} to ${entry.supplierName} has been confirmed.`, `/contractor/orders`]
                );
            } catch (notifErr) {}

            // =========================================================
            // A. 工項 (Work Item) 預算預警
            // =========================================================
            if (entry.workItemId) {
                try {
                    const [wiRows] = await conn.execute('SELECT Name, EstimatedCost FROM WorkItems WHERE WorkItemID = ?', [entry.workItemId]);
                    
                    if (wiRows.length > 0) {
                        const workItemName = wiRows[0].Name;
                        const budget = parseFloat(wiRows[0].EstimatedCost) || 0;

                        const [sumRows] = await conn.execute('SELECT SUM(TotalAmount) as TotalSpent FROM PurchaseOrder WHERE WorkItemID = ? AND Status != "Cancelled"', [entry.workItemId]);
                        const totalSpent = parseFloat(sumRows[0].TotalSpent) || 0;

                        if (budget > 0) {
                            if (totalSpent > budget) {
                                await conn.execute(
                                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                                    [contractorId, '⚠️ Work Item Over Budget!', `Spending on task "${workItemName}" ($${totalSpent.toLocaleString()}) has exceeded the budget ($${budget.toLocaleString()})!`, `/contractor/projects/${entry.projectId}`]
                                );
                            } else if (totalSpent > (budget * 0.8)) {
                                await conn.execute(
                                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                                    [contractorId, '📢 Work Item Budget Alert', `Warning: 80% of budget used for task "${workItemName}".`, `/contractor/projects/${entry.projectId}`]
                                );
                            }
                        }
                    }
                } catch (budgetErr) { console.error("Work Item Budget Check Error:", budgetErr); }
            }

            // =========================================================
            // B. ★★★ 新增：專案 (Project) 整體預算預警 ★★★
            // =========================================================
            if (entry.projectId) {
                try {
                    // 1. 抓取該「專案」的總預算
                    const [projRows] = await conn.execute('SELECT ProjectName, Budget FROM Projects WHERE ProjectID = ?', [entry.projectId]);
                    
                    if (projRows.length > 0) {
                        const projectName = projRows[0].ProjectName;
                        const projBudget = parseFloat(projRows[0].Budget) || 0;

                        // 2. 抓取該專案目前為止的總花費 (PurchaseOrder)
                        const [projSumRows] = await conn.execute('SELECT SUM(TotalAmount) as TotalSpent FROM PurchaseOrder WHERE ProjectID = ? AND Status != "Cancelled"', [entry.projectId]);
                        const projTotalSpent = parseFloat(projSumRows[0].TotalSpent) || 0;

                        // 3. 判斷是否超支
                        if (projBudget > 0) {
                            if (projTotalSpent > projBudget) {
                                // 嚴重超支
                                await conn.execute(
                                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                                    [contractorId, '🚨 PROJECT OVER BUDGET!', `Critical: Total spending on project "${projectName}" ($${projTotalSpent.toLocaleString()}) has exceeded the total budget ($${projBudget.toLocaleString()})!`, `/contractor/projects/${entry.projectId}`]
                                );
                            } else if (projTotalSpent > (projBudget * 0.9)) {
                                // 90% 預算提醒
                                await conn.execute(
                                    'INSERT INTO Notifications (ContractorID, Title, Message, Link) VALUES (?, ?, ?, ?)',
                                    [contractorId, '📢 Project Budget Warning', `Warning: You have used over 90% of the total budget for project "${projectName}".`, `/contractor/projects/${entry.projectId}`]
                                );
                            }
                        }
                    }
                } catch (projErr) { console.error("Project Budget Check Error:", projErr); }
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

// (原先的材料歷史 API 和 Mock Data API 已刪除)

module.exports = router;