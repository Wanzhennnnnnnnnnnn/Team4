const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const config = require('../config');
const pool = mysql.createPool(config.db);

// Helper function for type-safe contractor ownership verification
function verifyContractorOwnership(dbContractorId, cookieContractorId) {
    // Convert both to integers for comparison
    const dbId = parseInt(dbContractorId, 10);
    const cookieId = parseInt(cookieContractorId, 10);
    return dbId === cookieId;
}

// Helper: 兩階段渲染 (包含抓取承包商個人資料)
const renderWithLayout = async (req, res, viewName, data) => {
    try {
        // 1. 抓取當前登入的 Contractor 資料 (給 Layout 右上角用)
        const contractorId = req.signedCookies.userId;
        let currentUser = { Name: 'Contractor', Email: '', Address: '' };
        
        if (contractorId) {
            const [users] = await pool.execute('SELECT * FROM Contractors WHERE ContractorID = ?', [contractorId]);
            if (users.length > 0) {
                currentUser = users[0];
            }
        }

        // 2. 處理 View 路徑
        let viewPath = viewName;
        if (!viewName.includes('/')) {
            viewPath = `contractor/${viewName}`;
        }
        if (!viewPath.endsWith('.hjs')) {
            viewPath += '.hjs';
        }

        // 3. 渲染內容
        res.render(viewPath, data, (err, html) => {
            if (err) {
                console.error(`Error rendering view ${viewPath}:`, err);
                return res.status(500).send(`Template Error: ${err.message}`);
            }
            
            // 4. 渲染 Layout，並傳入 Contractor 的資料
            res.render('layout.hjs', { 
                ...data,
                content: html,
                contractorName: currentUser.Name,
                contractorEmail: currentUser.Email, 
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

        // ★★★ 搜尋邏輯 ★★★
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

        // Get work items for this project
        const [workItems] = await pool.execute(`
            SELECT
                WI.*,
                COUNT(DISTINCT WIM.WorkItemMaterialID) as MaterialCount,
                SUM(CASE WHEN WIM.Status = 'Delivered' THEN 1 ELSE 0 END) as DeliveredMaterialCount
            FROM WorkItems WI
            LEFT JOIN WorkItemMaterials WIM ON WI.WorkItemID = WIM.WorkItemID
            WHERE WI.ProjectID = ?
            GROUP BY WI.WorkItemID
            ORDER BY WI.CreatedAt DESC
        `, [projectId]);

        // Process work items to add status classes and format data
        const processedWorkItems = workItems.map(wi => ({
            ...wi,
            statusClass: getStatusClass(wi.Status),
            EstimatedCost: wi.EstimatedCost != null && !isNaN(parseFloat(wi.EstimatedCost))
                ? parseFloat(wi.EstimatedCost).toFixed(2)
                : null,
            MaterialCount: wi.MaterialCount || 0,
            DeliveredMaterialCount: wi.DeliveredMaterialCount || 0
        }));

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
            workItems: processedWorkItems,
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

        // ★★★ 搜尋邏輯 (與 Suppliers 列表相同) ★★★
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
            // 傳遞搜尋狀態
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
// 7. Supplier Details & Shopping Page
// ==========================================
router.get('/supplier/:id', async (req, res) => {
    try {
        const supplierId = req.params.id;
        const contractorId = req.signedCookies.userId;

        // 抓取網址參數中的 projectId 和 workItemId
        const preSelectedProjectId = req.query.projectId;
        const workItemId = req.query.workItemId;

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

        // 3. Get work item details if workItemId present
        let workItem = null;
        let requiredMaterialIds = [];

        if (workItemId) {
            const [workItemRows] = await pool.execute(
                'SELECT * FROM WorkItems WHERE WorkItemID = ?',
                [workItemId]
            );
            workItem = workItemRows[0];

            const [workItemMaterials] = await pool.execute(
                'SELECT MaterialID, RequiredQuantity FROM WorkItemMaterials WHERE WorkItemID = ?',
                [workItemId]
            );
            requiredMaterialIds = workItemMaterials.map(m => m.MaterialID);
        }

        // 4. 獲取承包商的進行中專案
        const [projects] = await pool.execute(
            'SELECT ProjectID, ProjectName FROM Projects WHERE ContractorID = ? AND Status != "Completed"',
            [contractorId]
        );

        // 處理預設選中專案 - if workItem exists, use its ProjectID
        const projectsWithSelection = projects.map(p => ({
            ...p,
            isSelected: (p.ProjectID == preSelectedProjectId) || (workItem && p.ProjectID == workItem.ProjectID)
        }));

        // 準備資料給前端
        const supplierData = {
            ...supplier, // 這會包含 Address, Email, PhoneNumber 等原始欄位
            CompanyName: supplier.SupplierName || supplier.Name,
            // ★★★ 確保電話和 Email 有預設值 ★★★
            PhoneNumber: supplier.PhoneNumber || 'N/A',
            Email: supplier.Email || 'N/A',
            items: materials.map(m => ({
                id: m.MaterialID,
                name: m.MaterialName,
                category: m.CategoryName || 'General',
                unit: m.UnitName || 'unit',
                price: m.PricePerUnit,
                stock: m.AvailableStock,
                isRequired: requiredMaterialIds.includes(m.MaterialID) // Mark required materials
            }))
        };

        await renderWithLayout(req, res, 'supplier_details', {
            title: `Purchase from ${supplierData.CompanyName}`,
            supplier: supplierData,
            projects: projectsWithSelection,
            workItem // Add work item to template data
        });

    } catch (err) {
        console.error(err);
        res.redirect('/contractor/suppliers');
    }
});

// 處理訂單送出 (POST)
router.post('/supplier/:id/create-order', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const supplierId = req.params.id;
        const contractorId = req.signedCookies.userId;
        const { project_id, delivery_date, cart_data, workItemId } = req.body;

        const items = JSON.parse(cart_data);

        if (!items || items.length === 0) {
            throw new Error('Cart is empty');
        }

        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.qty), 0);

        // Create PO with optional workItemId
        const [poResult] = await conn.execute(
            'INSERT INTO PurchaseOrder (ContractorID, ProjectID, SupplierID, WorkItemID, TotalAmount, Status, OrderDate) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [contractorId, project_id, supplierId, workItemId || null, totalAmount, 'Pending']
        );
        const poId = poResult.insertId;

        // Create PO items
        for (const item of items) {
            await conn.execute(
                'INSERT INTO POItems (POID, MaterialID, Quantity, UnitPrice) VALUES (?, ?, ?, ?)',
                [poId, item.id, item.qty, item.price]
            );

            // Update WorkItemMaterials allocation if workItemId present
            if (workItemId) {
                // Check if this material is already tracked for this work item
                const [existing] = await conn.execute(
                    'SELECT * FROM WorkItemMaterials WHERE WorkItemID = ? AND MaterialID = ?',
                    [workItemId, item.id]
                );

                if (existing.length > 0) {
                    // Update existing record
                    await conn.execute(`
                        UPDATE WorkItemMaterials
                        SET AllocatedQuantity = AllocatedQuantity + ?,
                            UnitPrice = ?,
                            Status = CASE
                                WHEN AllocatedQuantity + ? >= RequiredQuantity THEN 'Ordered'
                                ELSE 'Partially_Ordered'
                            END,
                            UpdatedAt = NOW()
                        WHERE WorkItemID = ? AND MaterialID = ?
                    `, [item.qty, item.price, item.qty, workItemId, item.id]);
                } else {
                    // Create new record for this material
                    await conn.execute(`
                        INSERT INTO WorkItemMaterials
                        (WorkItemID, MaterialID, RequiredQuantity, AllocatedQuantity, UnitPrice, Status)
                        VALUES (?, ?, ?, ?, ?, 'Ordered')
                    `, [workItemId, item.id, item.qty, item.qty, item.price]);
                }
            }
        }

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
        
        // ★★★ 修正重點：過濾掉舊的歷史訂單 ★★★
        // 舊的 CSV 匯入資料通常沒有 ProjectID (為 NULL)
        // 我們透過 JOIN Projects (Inner Join) 來只選取「有專案連結」的訂單，也就是您 App 內新增的訂單
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
// 9. Work Item Management
// ==========================================

// Helper function for status classes
function getStatusClass(status) {
    const statusClasses = {
        'Planning': 'bg-slate-100 text-slate-700',
        'In Progress': 'bg-blue-100 text-blue-700',
        'Completed': 'bg-green-100 text-green-700',
        'On Hold': 'bg-amber-100 text-amber-700'
    };
    return statusClasses[status] || 'bg-slate-100 text-slate-700';
}

// Create Work Item (POST)
router.post('/projects/:projectId/work-items/add', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const contractorId = req.signedCookies.userId;
        const { workItemType, workItemName, description, status, startDate, endDate, estimatedCost } = req.body;

        // Validate project ownership
        const [projectRows] = await pool.execute(
            'SELECT * FROM Projects WHERE ProjectID = ? AND ContractorID = ?',
            [projectId, contractorId]
        );

        if (projectRows.length === 0) {
            res.cookie('error', 'Unauthorized access to project', { maxAge: 10000 });
            return res.redirect('/contractor/projects');
        }

        // Create work item
        await pool.execute(
            `INSERT INTO WorkItems (ProjectID, WorkItemType, WorkItemName, Description, Status, StartDate, EndDate, EstimatedCost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                projectId,
                workItemType,
                workItemName,
                description || null,
                status || 'Planning',
                startDate || null,
                endDate || null,
                estimatedCost || null
            ]
        );

        res.cookie('success', 'Work item created successfully', { maxAge: 10000 });
        res.redirect(`/contractor/projects/${projectId}`);

    } catch (err) {
        console.error('Error creating work item:', err);
        res.cookie('error', 'Failed to create work item', { maxAge: 10000 });
        res.redirect('back');
    }
});

// View Work Item Details (GET)
router.get('/work-items/:id', async (req, res) => {
    try {
        const workItemId = req.params.id;
        const contractorId = req.signedCookies.userId;

        // Get work item with project info
        const [workItemRows] = await pool.execute(
            `SELECT WI.*, P.ProjectName, P.ContractorID
             FROM WorkItems WI
             JOIN Projects P ON WI.ProjectID = P.ProjectID
             WHERE WI.WorkItemID = ?`,
            [workItemId]
        );

        if (workItemRows.length === 0) {
            return res.redirect('/contractor/projects');
        }

        const workItem = workItemRows[0];

        // Verify ownership
        if (!verifyContractorOwnership(workItem.ContractorID, contractorId)) {
            console.error(`[AUTH] Work Item ${workItemId}: ContractorID mismatch`);
            return res.status(403).send('Unauthorized');
        }

        // Get materials for this work item
        const [materials] = await pool.execute(
            `SELECT
                WIM.*,
                M.MaterialName,
                U.UnitName,
                C.CategoryName
             FROM WorkItemMaterials WIM
             JOIN Materials M ON WIM.MaterialID = M.MaterialID
             LEFT JOIN Units U ON M.UnitID = U.UnitID
             LEFT JOIN Categories C ON M.CategoryID = C.CategoryID
             WHERE WIM.WorkItemID = ?
             ORDER BY WIM.CreatedAt DESC`,
            [workItemId]
        );

        // Process materials for display
        const processedMaterials = materials.map(m => ({
            ...m,
            fullyAllocated: m.AllocatedQuantity >= m.RequiredQuantity,
            totalCost: (m.RequiredQuantity * (m.UnitPrice || 0)).toFixed(2),
            materialStatusClass: getMaterialStatusClass(m.Status)
        }));

        // Format dates
        const formattedWorkItem = {
            ...workItem,
            StartDate: workItem.StartDate ? workItem.StartDate.toISOString().split('T')[0] : 'Not set',
            EndDate: workItem.EndDate ? workItem.EndDate.toISOString().split('T')[0] : 'Not set',
            EstimatedCost: workItem.EstimatedCost ? workItem.EstimatedCost.toFixed(2) : '0.00',
            ActualCost: workItem.ActualCost ? workItem.ActualCost.toFixed(2) : '0.00'
        };

        await renderWithLayout(req, res, 'work_item_details', {
            title: workItem.WorkItemName,
            workItem: formattedWorkItem,
            projectName: workItem.ProjectName,
            materials: processedMaterials,
            statusClass: getStatusClass(workItem.Status)
        });

    } catch (err) {
        console.error('Error fetching work item details:', err);
        res.redirect('/contractor/projects');
    }
});

// Purchase materials for work item (redirects to supplier selection)
router.get('/work-items/:id/purchase', async (req, res) => {
    try {
        const workItemId = req.params.id;
        const contractorId = req.signedCookies.userId;

        // Get work item and verify ownership
        const [workItemRows] = await pool.execute(
            `SELECT WI.*, P.ProjectID, P.ContractorID
             FROM WorkItems WI
             JOIN Projects P ON WI.ProjectID = P.ProjectID
             WHERE WI.WorkItemID = ?`,
            [workItemId]
        );

        if (workItemRows.length === 0) {
            return res.status(403).send('Unauthorized');
        }

        if (!verifyContractorOwnership(workItemRows[0].ContractorID, contractorId)) {
            console.error(`[AUTH] Work Item ${workItemId}: ContractorID mismatch`);
            return res.status(403).send('Unauthorized');
        }

        const workItem = workItemRows[0];

        // Redirect to create-po with workItemId parameter
        res.redirect(`/contractor/projects/${workItem.ProjectID}/create-po?workItemId=${workItemId}`);

    } catch (err) {
        console.error('Error initiating purchase:', err);
        res.redirect('/contractor/projects');
    }
});

// Helper function for material status classes
function getMaterialStatusClass(status) {
    const statusClasses = {
        'Pending': 'bg-slate-100 text-slate-700',
        'Ordered': 'bg-blue-100 text-blue-700',
        'Partially_Ordered': 'bg-amber-100 text-amber-700',
        'Partially_Delivered': 'bg-amber-100 text-amber-700',
        'Delivered': 'bg-green-100 text-green-700'
    };
    return statusClasses[status] || 'bg-slate-100 text-slate-700';
}

module.exports = router;