const express = require('express');
const router = express.Router();
let connection;

// 確保資料庫連線物件可用的中介軟體 (middleware)
router.use((req, res, next) => {
    // 從 app.js 取得資料庫連線
    connection = req.app.locals.connection;
    next();
});

// GET /register: 顯示註冊頁面 (不變)
router.get('/register', (req, res) => {
    // 假設您的註冊視圖檔名為 'register.hjs'
    res.render('register', { title: '承包商/供應商註冊' });
});

// POST /register: 處理註冊表單提交 (註冊成功後導向 /login)
router.post('/register', (req, res) => {
    const { username, password, company_name, contact_email, role } = req.body;

    if (!connection) {
        console.error('資料庫連線不可用！');
        return res.send('系統錯誤，資料庫連線遺失。');
    }
    if (!username || !password || !company_name || !role) {
        return res.send('錯誤：請填寫所有必填欄位。');
    }

    // 假設承包商/供應商註冊後立即啟用
    const initialStatus = 'Active';

    const sql = 'INSERT INTO partners (username, password, company_name, contact_email, role, status) VALUES (?, ?, ?, ?, ?, ?)';
    const values = [username, password, company_name, contact_email, role, initialStatus];

    connection.query(sql, values, (err, result) => {
        if (err) {
            console.error('註冊資料庫錯誤:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.send('錯誤：此帳號或公司名稱已存在。');
            }
            return res.send('系統錯誤，註冊失敗。');
        }

        // 註冊成功後，導向通用登入頁面，附帶成功訊息
        const successMsg = encodeURIComponent('✅ 註冊成功！請使用您的新帳號登入。');
        res.redirect(`/login?status=${successMsg}`);
    });
});

// **已移除 GET /login 路由，改由 app.js 處理**

// POST /login: 處理通用登入表單提交 (新增通用路由，處理多種身分)
router.post('/login', (req, res) => {
    // 從表單取得使用者輸入及選擇的身分
    const { username, password, role } = req.body;

    if (!connection) {
        const errorMsg = encodeURIComponent('系統錯誤：資料庫連線遺失。');
        return res.redirect(`/login?error=${errorMsg}`);
    }
    if (!username || !password || !role) {
        const errorMsg = encodeURIComponent('請輸入帳號、密碼並選擇您的身分。');
        return res.redirect(`/login?error=${errorMsg}`);
    }

    let sql, redirectPath, cookieName, queryParams;

    // 根據選擇的身分 (role) 決定查詢哪個資料表及設定參數
    if (role === '員工') {
        // 員工登入邏輯（已修正 emp_id/emp_password 欄位）
        sql = "SELECT * FROM employees WHERE emp_id = ? AND emp_password = ?";

        redirectPath = '/'; // 員工首頁使用 / 路由
        cookieName = 'user_id';
        queryParams = [username, password];

    } else if (role === 'Contractor' || role === 'Supplier') { // <<< 關鍵修正: 檢查英文角色字串
        // 假設：夥伴資訊儲存在 partners 表格，且狀態必須是 'Active'
        sql = "SELECT * FROM partners WHERE username = ? AND password = ? AND status = 'Active' AND role = ?";
        redirectPath = '/partner/home'; // 夥伴首頁
        cookieName = 'partner_id';
        queryParams = [username, password, role];
    } else {
        // 無效的身分選項
        const errorMsg = encodeURIComponent('無效的身分選項。');
        return res.redirect(`/login?error=${errorMsg}`);
    }

    // 執行資料庫查詢
    connection.query(sql, queryParams, (err, results) => {
        if (err) {
            console.error('登入查詢錯誤:', err);
            const errorMsg = encodeURIComponent('系統錯誤，請稍後再試。');
            return res.redirect(`/login?error=${errorMsg}`);
        }

        if (results.length > 0) {
            // 登入成功，設定 Cookie 並導向專屬首頁

            // 關鍵修正：在設定新的 Cookie 之前，先清除另一個身份的 Cookie
            if (role === '員工') {
                res.clearCookie('partner_id'); // 清除夥伴 Cookie
            } else if (role === 'Contractor' || role === 'Supplier') {
                res.clearCookie('user_id'); // 清除員工 Cookie
            }

            res.cookie(cookieName, username, { maxAge: 3600000, httpOnly: true });
            res.redirect(redirectPath);
        } else {
            // 登入失敗
            const errorMsg = encodeURIComponent('帳號或密碼錯誤，或帳號尚未啟用。');
            res.redirect(`/login?error=${errorMsg}`);
        }
    });
});

module.exports = router;